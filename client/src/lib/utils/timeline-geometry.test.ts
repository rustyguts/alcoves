import { describe, it, expect } from 'vitest';
import {
	MIN_MOMENT_SECONDS,
	NICE_STEPS,
	pxPerSecond,
	tickInterval,
	buildTicks,
	formatTimecode,
	clampDrag,
	snapThreshold,
	applySnap,
	snapCandidates,
	splitName
} from './timeline-geometry';

describe('pxPerSecond', () => {
	it('scales viewport width by zoom over duration', () => {
		expect(pxPerSecond(1000, 1, 10)).toBe(100);
		expect(pxPerSecond(1000, 2, 10)).toBe(200);
		expect(pxPerSecond(500, 4, 8)).toBe(250);
	});

	it('returns 0 for zero or negative duration', () => {
		expect(pxPerSecond(1000, 1, 0)).toBe(0);
		expect(pxPerSecond(1000, 1, -5)).toBe(0);
	});

	it('returns 0 for zero or negative container width', () => {
		expect(pxPerSecond(0, 1, 10)).toBe(0);
		expect(pxPerSecond(-100, 1, 10)).toBe(0);
	});

	it('returns 0 for zero or negative zoom', () => {
		expect(pxPerSecond(1000, 0, 10)).toBe(0);
		expect(pxPerSecond(1000, -2, 10)).toBe(0);
	});

	it('returns 0 for NaN inputs (negated comparison guard)', () => {
		expect(pxPerSecond(1000, 1, Number.NaN)).toBe(0);
		expect(pxPerSecond(Number.NaN, 1, 10)).toBe(0);
	});
});

describe('tickInterval', () => {
	it('returns the 60s default when pxPerSec is zero or negative', () => {
		expect(tickInterval(0)).toBe(60);
		expect(tickInterval(-10)).toBe(60);
	});

	it.each([
		[800, 0.1],
		[320, 0.25],
		[200, 0.5],
		[100, 1],
		[80, 1],
		[40, 2],
		[20, 5],
		[8, 10],
		[6, 15],
		[3, 30],
		[1.5, 60],
		[1, 120],
		[0.3, 300],
		[0.14, 600],
		[0.05, 1800],
		[0.025, 3600]
	])('pxPerSec=%d picks the first nice step ≥ 80/pxPerSec (%d s)', (pps, step) => {
		expect(tickInterval(pps)).toBe(step);
	});

	it('falls back to the largest nice step when even 3600 is too small', () => {
		expect(tickInterval(0.001)).toBe(NICE_STEPS[NICE_STEPS.length - 1]);
		expect(tickInterval(0.001)).toBe(3600);
	});

	it('treats an exact ladder hit as that step', () => {
		// 80 / 16 = 5 exactly → 5, not the next rung.
		expect(tickInterval(16)).toBe(5);
	});
});

describe('buildTicks', () => {
	it('returns no ticks when duration is zero or negative', () => {
		expect(buildTicks(0, 100)).toEqual([]);
		expect(buildTicks(-3, 100)).toEqual([]);
	});

	it('returns no ticks when pxPerSec is zero or negative', () => {
		expect(buildTicks(10, 0)).toEqual([]);
		expect(buildTicks(10, -1)).toEqual([]);
	});

	it('labels majors and leaves minors unlabeled', () => {
		// pxPerSec=8 → major every 10s, 5 minors → ticks every 2s over 10s.
		const ticks = buildTicks(10, 8);
		expect(ticks).toHaveLength(6);
		expect(ticks[0]).toEqual({ seconds: 0, leftPx: 0, major: true, label: '0:00' });
		const minors = ticks.slice(1, 5);
		for (const t of minors) {
			expect(t.major).toBe(false);
			expect(t.label).toBeNull();
		}
		const last = ticks[5]!;
		expect(last.seconds).toBeCloseTo(10, 6);
		expect(last.major).toBe(true);
		expect(last.label).toBe('0:10');
	});

	it('positions ticks at seconds × pxPerSec', () => {
		const ticks = buildTicks(10, 8);
		for (const t of ticks) {
			expect(t.leftPx).toBeCloseTo(t.seconds * 8, 6);
		}
	});

	it('uses tenth-second labels when the major interval is below 1s', () => {
		// pxPerSec=800 → major 0.1s, minor 0.02s.
		const ticks = buildTicks(1, 800);
		expect(ticks[0]!.label).toBe('0:00.0');
		const tenth = ticks.find((t) => t.major && Math.abs(t.seconds - 0.1) < 0.001);
		expect(tenth).toBeDefined();
		expect(tenth!.label).toBe('0:00.1');
		const lastMajor = ticks.filter((t) => t.major).at(-1)!;
		expect(lastMajor.label).toBe('0:01.0');
	});

	it('forces h:mm:ss labels when duration reaches an hour', () => {
		// pxPerSec=0.1 → major 1800s, minor 360s over a 3600s file.
		const ticks = buildTicks(3600, 0.1);
		const majors = ticks.filter((t) => t.major);
		expect(majors.map((t) => t.label)).toEqual(['0:00:00', '0:30:00', '1:00:00']);
		expect(ticks.filter((t) => !t.major).every((t) => t.label === null)).toBe(true);
	});

	it('keeps plain m:ss labels just under the hour threshold', () => {
		const ticks = buildTicks(3599, 0.1);
		expect(ticks[0]!.label).toBe('0:00');
	});
});

describe('formatTimecode', () => {
	it('formats m:ss by default', () => {
		expect(formatTimecode(0)).toBe('0:00');
		expect(formatTimecode(5)).toBe('0:05');
		expect(formatTimecode(65)).toBe('1:05');
		expect(formatTimecode(600)).toBe('10:00');
	});

	it('switches to h:mm:ss once hours are involved', () => {
		expect(formatTimecode(3600)).toBe('1:00:00');
		expect(formatTimecode(3661)).toBe('1:01:01');
		expect(formatTimecode(7325)).toBe('2:02:05');
	});

	it('forces hours when requested', () => {
		expect(formatTimecode(65, { forceHours: true })).toBe('0:01:05');
		expect(formatTimecode(0, { forceHours: true })).toBe('0:00:00');
	});

	it('appends fractional seconds for fractionDigits > 0', () => {
		expect(formatTimecode(1.234, { fractionDigits: 1 })).toBe('0:01.2');
		expect(formatTimecode(1.239, { fractionDigits: 2 })).toBe('0:01.24');
		expect(formatTimecode(83.04, { fractionDigits: 1 })).toBe('1:23.0');
	});

	it('rolls the fraction into the next whole second when rounding (59.96 → 1:00.0)', () => {
		expect(formatTimecode(59.96, { fractionDigits: 1 })).toBe('1:00.0');
	});

	it('rolls all the way into the next hour when rounding', () => {
		expect(formatTimecode(3599.96, { fractionDigits: 1 })).toBe('1:00:00.0');
	});

	it('treats negative, NaN and non-finite input as zero', () => {
		expect(formatTimecode(-5)).toBe('0:00');
		expect(formatTimecode(Number.NaN)).toBe('0:00');
		expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe('0:00');
		expect(formatTimecode(-5, { fractionDigits: 1 })).toBe('0:00.0');
	});
});

describe('clampDrag', () => {
	const initial = { startSeconds: 1, endSeconds: 3 };

	it('move shifts the whole range, preserving length', () => {
		expect(clampDrag('move', initial, 2, 10)).toEqual({ startSeconds: 3, endSeconds: 5 });
	});

	it('move clamps at the left edge', () => {
		expect(clampDrag('move', initial, -5, 10)).toEqual({ startSeconds: 0, endSeconds: 2 });
	});

	it('move clamps at the right edge', () => {
		expect(clampDrag('move', initial, 20, 10)).toEqual({ startSeconds: 8, endSeconds: 10 });
	});

	it('start resize moves only the start edge', () => {
		expect(clampDrag('start', initial, 0.5, 10)).toEqual({ startSeconds: 1.5, endSeconds: 3 });
	});

	it('start resize clamps at 0', () => {
		expect(clampDrag('start', initial, -5, 10)).toEqual({ startSeconds: 0, endSeconds: 3 });
	});

	it('start resize never crosses end − minLen', () => {
		const out = clampDrag('start', initial, 5, 10);
		expect(out.startSeconds).toBeCloseTo(3 - MIN_MOMENT_SECONDS, 9);
		expect(out.endSeconds).toBe(3);
	});

	it('end resize moves only the end edge', () => {
		expect(clampDrag('end', initial, 2, 10)).toEqual({ startSeconds: 1, endSeconds: 5 });
	});

	it('end resize clamps at duration', () => {
		expect(clampDrag('end', initial, 20, 10)).toEqual({ startSeconds: 1, endSeconds: 10 });
	});

	it('end resize never shrinks below start + minLen', () => {
		const out = clampDrag('end', initial, -5, 10);
		expect(out.startSeconds).toBe(1);
		expect(out.endSeconds).toBeCloseTo(1 + MIN_MOMENT_SECONDS, 9);
	});

	it('honors a custom minLen', () => {
		expect(clampDrag('start', initial, 5, 10, 0.5)).toEqual({ startSeconds: 2.5, endSeconds: 3 });
		expect(clampDrag('end', initial, -5, 10, 0.5)).toEqual({ startSeconds: 1, endSeconds: 1.5 });
	});

	it('does not mutate the initial range', () => {
		const frozen = { startSeconds: 1, endSeconds: 3 };
		clampDrag('move', frozen, 2, 10);
		expect(frozen).toEqual({ startSeconds: 1, endSeconds: 3 });
	});
});

describe('snapThreshold', () => {
	it('is 8px expressed in seconds', () => {
		expect(snapThreshold(16)).toBe(0.5);
		expect(snapThreshold(80)).toBe(0.1);
	});

	it('caps at one second when zoomed far out', () => {
		expect(snapThreshold(4)).toBe(1);
		expect(snapThreshold(8)).toBe(1);
		expect(snapThreshold(0.001)).toBe(1);
	});

	it('is 0 (snapping disabled) when pxPerSec ≤ 0', () => {
		expect(snapThreshold(0)).toBe(0);
		expect(snapThreshold(-10)).toBe(0);
	});
});

describe('applySnap', () => {
	it('snaps to the nearest candidate within the threshold', () => {
		expect(applySnap(5, [5.3, 4.9], 0.5)).toBe(4.9);
		expect(applySnap(5, [4.6, 5.2], 0.5)).toBe(5.2);
	});

	it('snaps to a candidate exactly at the threshold boundary', () => {
		expect(applySnap(5, [5.5], 0.5)).toBe(5.5);
	});

	it('returns the value unchanged when no candidate is within the threshold', () => {
		expect(applySnap(5, [6, 3.5], 0.4)).toBe(5);
	});

	it('returns the value unchanged for an empty candidate list', () => {
		expect(applySnap(5, [], 1)).toBe(5);
	});

	it('returns the value unchanged when the threshold is 0', () => {
		expect(applySnap(5, [5], 0)).toBe(5);
		expect(applySnap(5, [5.0001], -1)).toBe(5);
	});
});

describe('snapCandidates', () => {
	const ranges = [
		{ id: 'a', startSeconds: 0, endSeconds: 1 },
		{ id: 'b', startSeconds: 2, endSeconds: 3 }
	];

	it('includes the playhead plus every other moment edge, excluding the dragged id', () => {
		expect(snapCandidates(ranges, 'a', 9)).toEqual([9, 2, 3]);
		expect(snapCandidates(ranges, 'b', 4.5)).toEqual([4.5, 0, 1]);
	});

	it('includes all edges when nothing is excluded', () => {
		expect(snapCandidates(ranges, null, 0)).toEqual([0, 0, 1, 2, 3]);
		expect(snapCandidates(ranges, 'missing', 0)).toEqual([0, 0, 1, 2, 3]);
	});

	it('returns only the playhead for an empty range list', () => {
		expect(snapCandidates([], null, 7)).toEqual([7]);
	});
});

describe('splitName', () => {
	it('keeps an untitled moment untitled', () => {
		expect(splitName('')).toBe('');
	});

	it("appends ' (2)' to a plain name", () => {
		expect(splitName('Clip')).toBe('Clip (2)');
	});

	it('increments an existing counter', () => {
		expect(splitName('Clip (2)')).toBe('Clip (3)');
		expect(splitName('Clip (10)')).toBe('Clip (11)');
	});

	it('treats a non-numeric parenthetical as part of the name', () => {
		expect(splitName('Clip (final)')).toBe('Clip (final) (2)');
	});

	it('only increments a counter at the very end of the name', () => {
		expect(splitName('Clip (2) extra')).toBe('Clip (2) extra (2)');
	});
});
