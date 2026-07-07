/**
 * timeline-geometry — pure math for the editor timeline.
 *
 * Everything here is rune-free and DOM-free so the timeline components stay
 * thin and the seconds↔pixels arithmetic, tick ladder, drag clamping, snapping
 * and timecode formatting are all unit-testable in the node vitest project.
 */

export interface TimeRange {
	startSeconds: number;
	endSeconds: number;
}

export interface Tick {
	seconds: number;
	leftPx: number;
	major: boolean;
	label: string | null;
}

export type DragMode = 'move' | 'start' | 'end';

/** A highlight-filter match rendered on the merged markers lane. */
export interface TimelineMarker {
	id: string;
	filterId: string;
	name: string;
	color: string;
	startSeconds: number;
	title: string;
}

/**
 * Imperative surface the Timeline component hands its parent: view verbs for
 * the global keyboard shortcuts plus the pending-edit accessors the page needs
 * for split / set-to-playhead (which operate on effective, pending-merged
 * ranges and then clear the committed entry).
 */
export interface TimelineController {
	zoomIn: () => void;
	zoomOut: () => void;
	zoomToFit: () => void;
	scrollStep: (direction: -1 | 1) => void;
	centerPlayhead: () => void;
	getEffectiveRange: (momentId: string) => TimeRange | null;
	clearPending: (momentId: string) => void;
	hasPending: () => boolean;
}

/** Shortest a moment is allowed to get while dragging/nudging. */
export const MIN_MOMENT_SECONDS = 0.05;

/** "Nice" tick intervals the ruler picks from, in seconds. */
export const NICE_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

const MINOR_TICKS_PER_MAJOR = 5;
const TARGET_PX_BETWEEN_MAJOR_TICKS = 80;
/** Snap radius in screen pixels (converted to seconds via pxPerSec). */
const SNAP_THRESHOLD_PX = 8;
/** Snapping never yanks further than this many seconds, however far out the zoom. */
const SNAP_THRESHOLD_MAX_SECONDS = 1;

/** Pixels per second of media for a given viewport width and zoom factor. */
export function pxPerSecond(containerWidth: number, zoom: number, duration: number): number {
	if (!(duration > 0) || !(containerWidth > 0) || !(zoom > 0)) return 0;
	return (containerWidth * zoom) / duration;
}

/** The major-tick interval (seconds) that keeps labels readable at this scale. */
export function tickInterval(pxPerSec: number): number {
	if (pxPerSec <= 0) return 60;
	const rawSec = TARGET_PX_BETWEEN_MAJOR_TICKS / pxPerSec;
	return NICE_STEPS.find((s) => s >= rawSec) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
}

/**
 * Timecode formatter shared by the ruler, transport bar and moment panels.
 * `m:ss` by default, `h:mm:ss` once hours are involved (or forced), with an
 * optional fractional-seconds suffix (`1:23.4`).
 */
export function formatTimecode(
	seconds: number,
	opts: { forceHours?: boolean; fractionDigits?: number } = {}
): string {
	const { forceHours = false, fractionDigits = 0 } = opts;
	const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	const factor = 10 ** fractionDigits;
	const total = Math.round(safe * factor) / factor;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = Math.floor(total % 60);
	const pad = (n: number) => n.toString().padStart(2, '0');
	const base = forceHours || h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
	if (fractionDigits <= 0) return base;
	const frac = Math.round((total - Math.floor(total)) * factor)
		.toString()
		.padStart(fractionDigits, '0')
		// rounding to the next whole second is already folded into `total`
		.slice(0, fractionDigits);
	return `${base}.${frac}`;
}

/** Ruler ticks: minor steps with labels on major boundaries. */
export function buildTicks(duration: number, pxPerSec: number): Tick[] {
	const out: Tick[] = [];
	if (!(duration > 0) || pxPerSec <= 0) return out;
	const major = tickInterval(pxPerSec);
	const minor = major / MINOR_TICKS_PER_MAJOR;
	const epsilon = minor / 100;
	const forceHours = duration >= 3600;
	for (let s = 0; s <= duration + epsilon; s += minor) {
		const isMajor = Math.abs(s % major) < epsilon || Math.abs((s % major) - major) < epsilon;
		out.push({
			seconds: s,
			leftPx: s * pxPerSec,
			major: isMajor,
			label: isMajor ? formatTimecode(s, { forceHours, fractionDigits: major < 1 ? 1 : 0 }) : null
		});
	}
	return out;
}

/**
 * Apply a drag delta to a moment range. `move` shifts the whole range inside
 * [0, duration]; `start`/`end` resize one edge without crossing the other or
 * shrinking below `minLen`.
 */
export function clampDrag(
	mode: DragMode,
	initial: TimeRange,
	dxSec: number,
	duration: number,
	minLen = MIN_MOMENT_SECONDS
): TimeRange {
	let start = initial.startSeconds;
	let end = initial.endSeconds;
	if (mode === 'move') {
		const len = end - start;
		start = Math.max(0, Math.min(duration - len, initial.startSeconds + dxSec));
		end = start + len;
	} else if (mode === 'start') {
		start = Math.max(0, Math.min(end - minLen, initial.startSeconds + dxSec));
	} else {
		end = Math.min(duration, Math.max(start + minLen, initial.endSeconds + dxSec));
	}
	return { startSeconds: start, endSeconds: end };
}

/** Snap radius in seconds for the current zoom; 0 disables snapping. */
export function snapThreshold(pxPerSec: number): number {
	if (pxPerSec <= 0) return 0;
	return Math.min(SNAP_THRESHOLD_PX / pxPerSec, SNAP_THRESHOLD_MAX_SECONDS);
}

/** Nearest candidate within `threshold` of `value`, or `value` unchanged. */
export function applySnap(value: number, candidates: number[], threshold: number): number {
	if (threshold <= 0) return value;
	let best = value;
	let bestDist = threshold;
	for (const c of candidates) {
		const dist = Math.abs(c - value);
		if (dist <= bestDist) {
			best = c;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * Snap targets while dragging one moment: every other moment's (effective)
 * edges plus the playhead.
 */
export function snapCandidates(
	ranges: Array<{ id: string } & TimeRange>,
	excludeId: string | null,
	playheadSeconds: number
): number[] {
	const out: number[] = [playheadSeconds];
	for (const r of ranges) {
		if (r.id === excludeId) continue;
		out.push(r.startSeconds, r.endSeconds);
	}
	return out;
}

/**
 * Name for the right-hand half of a split: `'Clip'` → `'Clip (2)'`,
 * `'Clip (2)'` → `'Clip (3)'`, untitled stays untitled.
 */
export function splitName(name: string): string {
	if (!name) return '';
	const match = /^(.*) \((\d+)\)$/.exec(name);
	if (match) return `${match[1]} (${Number(match[2]) + 1})`;
	return `${name} (2)`;
}
