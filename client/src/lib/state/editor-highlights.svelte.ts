import { createHighlightFilters } from '$lib/state/highlight-filters.svelte';
import { toast } from '$lib/state/toast';
import { parseVtt, type VttCue } from '$lib/utils/parse-vtt';
import {
	parseExpression,
	type AndGroup,
	type ParsedExpression,
	type Term
} from '$lib/utils/highlight-expression';
import type {
	AudioDetection,
	HighlightFilter,
	HighlightFilterCreate,
	HighlightFilterPatch
} from '$lib/types/api';

export interface FilterMatch {
	filterId: string;
	startSeconds: number;
	endSeconds: number;
	/** Aggregate confidence for this match. 0–1. */
	score: number;
	/** Per-term evidence in display order (one entry per AND term). */
	evidence: string[];
}

export interface FilterAggregate {
	count: number;
	meanScore: number;
	maxScore: number;
	/** Parser errors, if any (so the UI can flag a bad expression). */
	expressionErrors: string[];
}

interface TermHit {
	startSeconds: number;
	endSeconds: number;
	score: number;
	evidence: string;
}

function hitsForTerm(term: Term, audioDetections: AudioDetection[], cues: VttCue[]): TermHit[] {
	const value = term.value;
	if (!value) return [];
	if (term.type === 'audio') {
		return audioDetections
			.filter((d) => d.label.toLowerCase().includes(value) && d.score >= term.minScore)
			.map((d) => ({
				startSeconds: d.startSeconds,
				endSeconds: d.endSeconds,
				score: d.score,
				evidence: d.label
			}));
	}
	// word
	return cues
		.filter((c) => c.text.toLowerCase().includes(value))
		.map((c) => ({
			startSeconds: c.startSeconds,
			endSeconds: c.endSeconds,
			score: 1,
			evidence: c.text
		}));
}

/**
 * For a single AND group, compute matches: every hit on the first term anchors
 * a candidate window; all other terms must have at least one hit whose midpoint
 * is within `proximitySec` of the anchor's midpoint.
 */
function evaluateAndGroup(
	group: AndGroup,
	audioDetections: AudioDetection[],
	cues: VttCue[],
	proximitySec: number,
	filterId: string
): FilterMatch[] {
	if (group.terms.length === 0) return [];
	const allHits = group.terms.map((t) => hitsForTerm(t, audioDetections, cues));
	if (allHits.some((list) => list.length === 0)) return [];

	// Single-term AND group → trivial union of its hits.
	if (group.terms.length === 1) {
		return allHits[0]!.map((h) => ({
			filterId,
			startSeconds: h.startSeconds,
			endSeconds: h.endSeconds,
			score: h.score,
			evidence: [h.evidence]
		}));
	}

	const out: FilterMatch[] = [];

	const seenAnchors = new Set<string>();
	for (const anchor of allHits[0]!) {
		const anchorMid = (anchor.startSeconds + anchor.endSeconds) / 2;
		const partners: TermHit[] = [];
		let ok = true;
		for (let i = 1; i < allHits.length; i++) {
			const list = allHits[i]!;
			let best: TermHit | null = null;
			let bestDelta = Infinity;
			for (const h of list) {
				const mid = (h.startSeconds + h.endSeconds) / 2;
				const delta = Math.abs(mid - anchorMid);
				if (delta <= proximitySec && delta < bestDelta) {
					best = h;
					bestDelta = delta;
				}
			}
			if (!best) {
				ok = false;
				break;
			}
			partners.push(best);
		}
		if (!ok) continue;

		const all = [anchor, ...partners];
		const start = Math.min(...all.map((h) => h.startSeconds));
		const end = Math.max(...all.map((h) => h.endSeconds));
		const score = all.reduce((s, h) => s + h.score, 0) / all.length;

		const key = `${start.toFixed(2)}|${end.toFixed(2)}`;
		if (seenAnchors.has(key)) continue;
		seenAnchors.add(key);

		out.push({
			filterId,
			startSeconds: start,
			endSeconds: end,
			score,
			evidence: all.map((h) => h.evidence)
		});
	}
	return out;
}

function computeMatches(
	filters: HighlightFilter[],
	parsedByFilter: Record<string, ParsedExpression>,
	audioDetections: AudioDetection[],
	cues: VttCue[]
): Record<string, FilterMatch[]> {
	const out: Record<string, FilterMatch[]> = {};
	for (const f of filters) {
		const parsed = parsedByFilter[f.id];
		if (!parsed || parsed.groups.length === 0) {
			out[f.id] = [];
			continue;
		}
		const proximity = Math.max(0, f.proximitySeconds || 0);
		const groupResults: FilterMatch[] = [];

		const seen = new Set<string>();
		for (const g of parsed.groups) {
			const matchesForGroup = evaluateAndGroup(g, audioDetections, cues, proximity, f.id);
			for (const m of matchesForGroup) {
				const key = `${m.startSeconds.toFixed(2)}|${m.endSeconds.toFixed(2)}|${m.evidence.join('|')}`;
				if (seen.has(key)) continue;
				seen.add(key);
				groupResults.push(m);
			}
		}
		groupResults.sort((a, b) => a.startSeconds - b.startSeconds);
		out[f.id] = groupResults;
	}
	return out;
}

function computeAggregates(
	filters: HighlightFilter[],
	matches: Record<string, FilterMatch[]>,
	parsedByFilter: Record<string, ParsedExpression>
): Record<string, FilterAggregate> {
	const out: Record<string, FilterAggregate> = {};
	for (const f of filters) {
		const list = matches[f.id] ?? [];
		const errs = parsedByFilter[f.id]?.errors ?? [];
		if (list.length === 0) {
			out[f.id] = { count: 0, meanScore: 0, maxScore: 0, expressionErrors: errs };
			continue;
		}
		let sum = 0;
		let max = 0;
		for (const m of list) {
			sum += m.score;
			if (m.score > max) max = m.score;
		}
		out[f.id] = {
			count: list.length,
			meanScore: sum / list.length,
			maxScore: max,
			expressionErrors: errs
		};
	}
	return out;
}

/**
 * Editor-flavored facade over `createHighlightFilters` — same CRUD, plus the
 * matches/aggregates derivation against the file's audio detections + VTT, with
 * toast feedback wired in.
 *
 * Reactive inputs are getter functions so the store tracks the consuming
 * component's reactive `libraryId` / `audioDetections` / `transcriptVtt`. State
 * is exposed via getters so reactivity survives the function boundary. The
 * consuming component calls `refresh()` from its own `onMount`/`$effect` (the
 * factory has no construction-time side effects).
 */
export function createEditorHighlights(
	getLibraryId: () => string,
	getAudioDetections: () => AudioDetection[],
	getTranscriptVtt: () => string | null | undefined
) {
	const filtersStore = createHighlightFilters(getLibraryId);

	const cues = $derived<VttCue[]>(parseVtt(getTranscriptVtt() ?? ''));

	const parsedByFilter = $derived.by<Record<string, ParsedExpression>>(() => {
		const out: Record<string, ParsedExpression> = {};
		for (const f of filtersStore.filters) {
			out[f.id] = parseExpression(f.expression ?? '');
		}
		return out;
	});

	const matches = $derived.by(() =>
		computeMatches(filtersStore.filters, parsedByFilter, getAudioDetections(), cues)
	);

	const aggregates = $derived.by(() =>
		computeAggregates(filtersStore.filters, matches, parsedByFilter)
	);

	const hasSignals = $derived(
		getAudioDetections().length > 0 || (getTranscriptVtt()?.length ?? 0) > 0
	);

	async function onCreate(body: HighlightFilterCreate) {
		try {
			await filtersStore.create(body);
			toast.add({ title: `Filter "${body.name}" added`, color: 'success' });
		} catch {
			toast.add({ title: 'Failed to add filter', color: 'error' });
		}
	}

	async function onUpdate(id: string, body: HighlightFilterPatch) {
		try {
			await filtersStore.update(id, body);
		} catch {
			toast.add({ title: 'Failed to update filter', color: 'error' });
		}
	}

	async function onRemove(id: string) {
		try {
			await filtersStore.remove(id);
		} catch {
			toast.add({ title: 'Failed to delete filter', color: 'error' });
		}
	}

	async function onLoadPresets() {
		try {
			await filtersStore.loadPresets();
			toast.add({ title: 'Presets loaded', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to load presets', color: 'error' });
		}
	}

	return {
		get filters() {
			return filtersStore.filters;
		},
		get loading() {
			return filtersStore.loading;
		},
		get cues() {
			return cues;
		},
		get matches() {
			return matches;
		},
		get aggregates() {
			return aggregates;
		},
		get hasSignals() {
			return hasSignals;
		},
		refresh: filtersStore.refresh,
		onCreate,
		onUpdate,
		onRemove,
		onLoadPresets
	};
}
