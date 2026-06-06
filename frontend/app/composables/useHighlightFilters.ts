import { ref, computed, type Ref, type ComputedRef } from "vue";
import { api } from "~/api";
import type {
  AudioDetection,
  HighlightFilter,
  HighlightFilterCreate,
  HighlightFilterPatch,
} from "~~/shared/types/api";
import { parseVtt, type VttCue } from "~/utils/parse-vtt";
import {
  parseExpression,
  type AndGroup,
  type ParsedExpression,
  type Term,
} from "~/utils/highlight-expression";

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

export const HIGHLIGHT_PRESETS: HighlightFilterCreate[] = [
  { name: "Laughter", expression: "laughter:25, giggle, snicker", color: "#98C379" },
  { name: "Screaming", expression: "screaming:30, yell, shout", color: "#E06C75" },
  { name: "Cheering", expression: "cheering:25, applause, whoop", color: "#E5C07B" },
  { name: "Gunshot", expression: "gunshot:30, machine gun:30", color: "#5C6370" },
  { name: "Profanity", expression: "word:shit, word:fuck, word:damn, word:hell", color: "#C678DD" },
  { name: "Reactions", expression: "word:wtf, word:bro, word:dude, word:bruh", color: "#56B6C2" },
  {
    name: "Funny clip",
    expression: "laughter:25 & word:bro, screaming:30 & word:wtf",
    color: "#D19A66",
  },
];

export function useHighlightFilters(libraryId: Ref<string>) {
  const filters = ref<HighlightFilter[]>([]);
  const loading = ref(false);
  const error = ref<unknown>(null);

  async function refresh() {
    if (!libraryId.value) return;
    loading.value = true;
    error.value = null;
    try {
      filters.value = (await api.highlightFilters.list(libraryId.value)) ?? [];
    } catch (err) {
      error.value = err;
    } finally {
      loading.value = false;
    }
  }

  async function create(body: HighlightFilterCreate): Promise<HighlightFilter> {
    const created = await api.highlightFilters.create(libraryId.value, body);
    filters.value = [...filters.value, created];
    return created;
  }

  async function update(filterId: string, body: HighlightFilterPatch): Promise<HighlightFilter> {
    const updated = await api.highlightFilters.update(libraryId.value, filterId, body);
    filters.value = filters.value.map((f) => (f.id === filterId ? updated : f));
    return updated;
  }

  async function remove(filterId: string): Promise<void> {
    await api.highlightFilters.remove(libraryId.value, filterId);
    filters.value = filters.value.filter((f) => f.id !== filterId);
  }

  async function loadPresets(): Promise<void> {
    for (const preset of HIGHLIGHT_PRESETS) {
      try {
        await create(preset);
      } catch {
        /* ignore individual preset failures */
      }
    }
  }

  return {
    filters,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
    loadPresets,
  };
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
  if (term.type === "audio") {
    return audioDetections
      .filter((d) => d.label.toLowerCase().includes(value) && d.score >= term.minScore)
      .map((d) => ({
        startSeconds: d.startSeconds,
        endSeconds: d.endSeconds,
        score: d.score,
        evidence: d.label,
      }));
  }
  // word
  return cues
    .filter((c) => c.text.toLowerCase().includes(value))
    .map((c) => ({
      startSeconds: c.startSeconds,
      endSeconds: c.endSeconds,
      score: 1,
      evidence: c.text,
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
  filterId: string,
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
      evidence: [h.evidence],
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
      evidence: all.map((h) => h.evidence),
    });
  }
  return out;
}

export function useHighlightMatches(
  filters: Ref<HighlightFilter[]>,
  audioDetections: Ref<AudioDetection[]>,
  transcriptVtt: Ref<string | null | undefined>,
): {
  cues: ComputedRef<VttCue[]>;
  matches: ComputedRef<Record<string, FilterMatch[]>>;
  aggregates: ComputedRef<Record<string, FilterAggregate>>;
} {
  const cues = computed<VttCue[]>(() => parseVtt(transcriptVtt.value ?? ""));

  const parsedByFilter = computed<Record<string, ParsedExpression>>(() => {
    const out: Record<string, ParsedExpression> = {};
    for (const f of filters.value) {
      out[f.id] = parseExpression(f.expression ?? "");
    }
    return out;
  });

  const matches = computed<Record<string, FilterMatch[]>>(() => {
    const out: Record<string, FilterMatch[]> = {};
    for (const f of filters.value) {
      const parsed = parsedByFilter.value[f.id];
      if (!parsed || parsed.groups.length === 0) {
        out[f.id] = [];
        continue;
      }
      const proximity = Math.max(0, f.proximitySeconds || 0);
      const groupResults: FilterMatch[] = [];
      const seen = new Set<string>();
      for (const g of parsed.groups) {
        const matchesForGroup = evaluateAndGroup(
          g,
          audioDetections.value,
          cues.value,
          proximity,
          f.id,
        );
        for (const m of matchesForGroup) {
          const key = `${m.startSeconds.toFixed(2)}|${m.endSeconds.toFixed(2)}|${m.evidence.join("|")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          groupResults.push(m);
        }
      }
      groupResults.sort((a, b) => a.startSeconds - b.startSeconds);
      out[f.id] = groupResults;
    }
    return out;
  });

  const aggregates = computed<Record<string, FilterAggregate>>(() => {
    const out: Record<string, FilterAggregate> = {};
    for (const f of filters.value) {
      const list = matches.value[f.id] ?? [];
      const errs = parsedByFilter.value[f.id]?.errors ?? [];
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
        expressionErrors: errs,
      };
    }
    return out;
  });

  return { cues, matches, aggregates };
}
