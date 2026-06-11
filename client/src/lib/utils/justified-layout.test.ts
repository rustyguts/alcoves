import { describe, it, expect } from 'vitest';
import { justifiedLayout } from './justified-layout';

interface Item {
	id: string;
	aspect: number;
}

const aspectOf = (i: Item) => i.aspect;

function items(...aspects: number[]): Item[] {
	return aspects.map((aspect, idx) => ({ id: String(idx), aspect }));
}

describe('justifiedLayout', () => {
	it('returns no rows for an empty list', () => {
		expect(
			justifiedLayout([], aspectOf, { containerWidth: 1000, targetRowHeight: 200, gap: 4 })
		).toEqual([]);
	});

	it('packs items into rows that fill the container width', () => {
		// 10 landscape (3:2) photos in a 1000px container, target 200px tall.
		const rows = justifiedLayout(items(...Array(10).fill(1.5)), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 4
		});
		// Every non-last row must span the full width within a rounding epsilon.
		for (const row of rows) {
			if (row.last) continue;
			const used = row.boxes.reduce((s, b) => s + b.width, 0) + 4 * (row.boxes.length - 1);
			expect(used).toBeCloseTo(1000, 1);
		}
		// All items accounted for exactly once.
		expect(rows.flatMap((r) => r.boxes).length).toBe(10);
		// More than one row is produced for this many items.
		expect(rows.length).toBeGreaterThan(1);
	});

	it('keeps every box in a row at the same height', () => {
		const rows = justifiedLayout(items(1.5, 0.7, 1.0, 2.2, 1.3, 0.9), aspectOf, {
			containerWidth: 900,
			targetRowHeight: 180,
			gap: 6
		});
		for (const row of rows) {
			for (const box of row.boxes) {
				expect(box.height).toBe(row.height);
				expect(box.width).toBeCloseTo(box.aspect * box.height, 5);
			}
		}
	});

	it('does not stretch the trailing row to full width', () => {
		const rows = justifiedLayout(items(1.5, 1.5), aspectOf, {
			containerWidth: 2000,
			targetRowHeight: 200,
			gap: 4
		});
		// Two photos can't fill a 2000px row, so it's the last row at target height.
		expect(rows).toHaveLength(1);
		expect(rows[0]!.last).toBe(true);
		expect(rows[0]!.height).toBe(200);
		const used = rows[0]!.boxes.reduce((s, b) => s + b.width, 0);
		expect(used).toBeLessThan(2000);
	});

	it('stretches the trailing row to full width when stretchLastRow is set', () => {
		// Two photos that wouldn't fill a 2000px row are stretched to span it.
		const rows = justifiedLayout(items(1.5, 1.5), aspectOf, {
			containerWidth: 2000,
			targetRowHeight: 200,
			gap: 4,
			maxRowHeight: 10000, // don't cap, so the stretch is observable
			stretchLastRow: true
		});
		expect(rows).toHaveLength(1);
		const row = rows[0]!;
		const used = row.boxes.reduce((s, b) => s + b.width, 0) + 4 * (row.boxes.length - 1);
		expect(used).toBeCloseTo(2000, 1);
	});

	it('does not stretch a lone trailing item even with stretchLastRow', () => {
		const rows = justifiedLayout(items(1.5), aspectOf, {
			containerWidth: 2000,
			targetRowHeight: 200,
			gap: 0,
			maxRowHeight: 320,
			stretchLastRow: true
		});
		// A single leftover photo stays at target height, not blown up full-width.
		expect(rows[0]!.height).toBe(200);
		expect(rows[0]!.boxes[0]!.width).toBeLessThan(2000);
	});

	it('caps justified row height for a lone wide item', () => {
		const rows = justifiedLayout(items(1.5), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 0,
			maxRowHeight: 260
		});
		expect(rows[0]!.height).toBeLessThanOrEqual(260);
	});

	it('clamps extreme aspect ratios', () => {
		const rows = justifiedLayout(items(20, 0.05), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 4,
			maxAspect: 3,
			minAspect: 0.5
		});
		const aspects = rows.flatMap((r) => r.boxes).map((b) => b.aspect);
		expect(Math.max(...aspects)).toBeLessThanOrEqual(3);
		expect(Math.min(...aspects)).toBeGreaterThanOrEqual(0.5);
	});

	it('falls back to natural-height boxes when the container is unmeasured', () => {
		const rows = justifiedLayout(items(1.5, 0.8), aspectOf, {
			containerWidth: 0,
			targetRowHeight: 200,
			gap: 4
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]!.last).toBe(true);
		expect(rows[0]!.boxes[0]!.width).toBeCloseTo(1.5 * 200, 5);
	});

	it('treats invalid aspect ratios as square', () => {
		const rows = justifiedLayout(items(Number.NaN, 0, -2), aspectOf, {
			containerWidth: 600,
			targetRowHeight: 150,
			gap: 0
		});
		for (const box of rows.flatMap((r) => r.boxes)) {
			expect(box.aspect).toBe(1);
		}
	});

	// --- Additional edge cases for full branch coverage ---

	it('handles a negative container width like an unmeasured one', () => {
		// `!(containerWidth > 0)` also catches negatives and NaN.
		const rows = justifiedLayout(items(1.5, 2.0), aspectOf, {
			containerWidth: -100,
			targetRowHeight: 120,
			gap: 8
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]!.last).toBe(true);
		expect(rows[0]!.boxes).toHaveLength(2);
		// Each box uses its (clamped) aspect at the target height.
		expect(rows[0]!.boxes[0]!.height).toBe(120);
		expect(rows[0]!.boxes[0]!.width).toBeCloseTo(1.5 * 120, 5);
		// 2.0 is within [0.5, 3] so it is preserved.
		expect(rows[0]!.boxes[1]!.aspect).toBe(2.0);
	});

	it('clamps aspects in the unmeasured-container fallback path too', () => {
		const rows = justifiedLayout(items(20, 0.01, Number.NaN), aspectOf, {
			containerWidth: 0,
			targetRowHeight: 100,
			gap: 0,
			minAspect: 0.5,
			maxAspect: 3
		});
		const boxes = rows[0]!.boxes;
		expect(boxes[0]!.aspect).toBe(3); // 20 clamped to maxAspect
		expect(boxes[1]!.aspect).toBe(0.5); // 0.01 clamped to minAspect
		expect(boxes[2]!.aspect).toBe(1); // NaN → 1
		// Widths track the clamped aspect at the target height.
		expect(boxes[0]!.width).toBeCloseTo(3 * 100, 5);
	});

	it('uses the default maxRowHeight (1.5x target) to cap a stretched row', () => {
		// Two square items in a very wide container; stretchLastRow tries to scale
		// the row tall, but the implicit maxRowHeight (1.5 * target = 300) caps it.
		const rows = justifiedLayout(items(1, 1), aspectOf, {
			containerWidth: 4000,
			targetRowHeight: 200,
			gap: 0,
			stretchLastRow: true
		});
		expect(rows).toHaveLength(1);
		// default maxRowHeight = 1.5 * 200 = 300 caps the would-be ~2000 height.
		expect(rows[0]!.height).toBe(300);
	});

	it('caps a stretched multi-item last row at maxRowHeight', () => {
		// Two narrow-ish items in a very wide container would stretch tall, but the
		// (default) maxRowHeight caps the height.
		const rows = justifiedLayout(items(1.0, 1.0), aspectOf, {
			containerWidth: 4000,
			targetRowHeight: 200,
			gap: 0,
			stretchLastRow: true
		});
		expect(rows).toHaveLength(1);
		// Stretch wants height = 2000, but default maxRowHeight = 1.5 * 200 = 300.
		expect(rows[0]!.height).toBe(300);
	});

	it('produces a single full-width row when items exactly fill the width', () => {
		// Build items whose natural width at target height meets the container so
		// the loop flushes a non-last row, then a final empty flush is a no-op.
		const rows = justifiedLayout(items(2.5, 2.5), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 0
		});
		// 2.5 * 200 + 2.5 * 200 = 1000 → meets container → flush(false).
		const first = rows[0]!;
		expect(first.last).toBe(false);
		const used = first.boxes.reduce((s, b) => s + b.width, 0);
		expect(used).toBeCloseTo(1000, 1);
		// No trailing leftover row.
		expect(rows).toHaveLength(1);
	});

	it('handles a single narrow item (no stretch, no cap hit)', () => {
		const rows = justifiedLayout(items(0.6), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 150,
			gap: 4
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]!.last).toBe(true);
		expect(rows[0]!.height).toBe(150);
		expect(rows[0]!.boxes[0]!.width).toBeCloseTo(0.6 * 150, 5);
	});

	it('accounts for the gap when justifying full rows', () => {
		const gap = 10;
		const rows = justifiedLayout(items(...Array(8).fill(1.5)), aspectOf, {
			containerWidth: 1200,
			targetRowHeight: 220,
			gap
		});
		for (const row of rows) {
			if (row.last) continue;
			const used = row.boxes.reduce((s, b) => s + b.width, 0) + gap * (row.boxes.length - 1);
			expect(used).toBeCloseTo(1200, 1);
		}
	});

	it('keeps the last row at target height when it is not stretched and well under max', () => {
		const rows = justifiedLayout(items(1.5, 1.5, 1.5, 1.5, 1.5), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 4
		});
		const last = rows[rows.length - 1]!;
		expect(last.last).toBe(true);
		expect(last.height).toBe(200);
	});
});
