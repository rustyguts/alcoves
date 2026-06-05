import { describe, expect, it } from "vitest";
import { justifiedLayout } from "~/utils/justified-layout";

interface Item {
	id: string;
	aspect: number;
}

const aspectOf = (i: Item) => i.aspect;

function items(...aspects: number[]): Item[] {
	return aspects.map((aspect, idx) => ({ id: String(idx), aspect }));
}

describe("justifiedLayout", () => {
	it("returns no rows for an empty list", () => {
		expect(justifiedLayout([], aspectOf, { containerWidth: 1000, targetRowHeight: 200, gap: 4 })).toEqual([]);
	});

	it("packs items into rows that fill the container width", () => {
		// 10 landscape (3:2) photos in a 1000px container, target 200px tall.
		const rows = justifiedLayout(items(...Array(10).fill(1.5)), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 4,
		});
		// Every non-last row must span the full width within a rounding epsilon.
		for (const row of rows) {
			if (row.last) continue;
			const used = row.boxes.reduce((s, b) => s + b.width, 0) + 4 * (row.boxes.length - 1);
			expect(used).toBeCloseTo(1000, 1);
		}
		// All items accounted for exactly once.
		expect(rows.flatMap((r) => r.boxes).length).toBe(10);
	});

	it("keeps every box in a row at the same height", () => {
		const rows = justifiedLayout(items(1.5, 0.7, 1.0, 2.2, 1.3, 0.9), aspectOf, {
			containerWidth: 900,
			targetRowHeight: 180,
			gap: 6,
		});
		for (const row of rows) {
			for (const box of row.boxes) {
				expect(box.height).toBe(row.height);
				expect(box.width).toBeCloseTo(box.aspect * box.height, 5);
			}
		}
	});

	it("does not stretch the trailing row to full width", () => {
		const rows = justifiedLayout(items(1.5, 1.5), aspectOf, {
			containerWidth: 2000,
			targetRowHeight: 200,
			gap: 4,
		});
		// Two photos can't fill a 2000px row, so it's the last row at target height.
		expect(rows).toHaveLength(1);
		expect(rows[0]!.last).toBe(true);
		expect(rows[0]!.height).toBe(200);
		const used = rows[0]!.boxes.reduce((s, b) => s + b.width, 0);
		expect(used).toBeLessThan(2000);
	});

	it("caps justified row height for a lone wide item", () => {
		const rows = justifiedLayout(items(1.5), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 0,
			maxRowHeight: 260,
		});
		expect(rows[0]!.height).toBeLessThanOrEqual(260);
	});

	it("clamps extreme aspect ratios", () => {
		const rows = justifiedLayout(items(20, 0.05), aspectOf, {
			containerWidth: 1000,
			targetRowHeight: 200,
			gap: 4,
			maxAspect: 3,
			minAspect: 0.5,
		});
		const aspects = rows.flatMap((r) => r.boxes).map((b) => b.aspect);
		expect(Math.max(...aspects)).toBeLessThanOrEqual(3);
		expect(Math.min(...aspects)).toBeGreaterThanOrEqual(0.5);
	});

	it("falls back to natural-height boxes when the container is unmeasured", () => {
		const rows = justifiedLayout(items(1.5, 0.8), aspectOf, {
			containerWidth: 0,
			targetRowHeight: 200,
			gap: 4,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]!.last).toBe(true);
		expect(rows[0]!.boxes[0]!.width).toBeCloseTo(1.5 * 200, 5);
	});

	it("treats invalid aspect ratios as square", () => {
		const rows = justifiedLayout(items(Number.NaN, 0, -2), aspectOf, {
			containerWidth: 600,
			targetRowHeight: 150,
			gap: 0,
		});
		for (const box of rows.flatMap((r) => r.boxes)) {
			expect(box.aspect).toBe(1);
		}
	});
});
