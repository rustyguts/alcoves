/**
 * Justified (Google-Photos-style) row layout.
 *
 * Packs a list of items — each with a known aspect ratio — into rows that fill
 * the container width edge-to-edge, the way Google Photos / Flickr lay out a
 * gallery. Items keep their native aspect ratio; each row's height is solved so
 * the row's scaled widths (plus inter-item gaps) exactly span `containerWidth`.
 *
 * The algorithm is a single greedy pass: keep adding items to the current row
 * until they would overflow the target row height, then scale the row to fit.
 * It is deterministic and O(n) — safe to run reactively on every resize.
 */

export interface JustifiedBox<T> {
	item: T;
	/** Display width in CSS px. */
	width: number;
	/** Display height in CSS px (equals the row height). */
	height: number;
	/** Native aspect ratio actually used (after clamping). */
	aspect: number;
}

export interface JustifiedRow<T> {
	boxes: JustifiedBox<T>[];
	height: number;
	/** True for a trailing row that was not stretched to full width. */
	last: boolean;
}

export interface JustifiedOptions {
	containerWidth: number;
	/** Ideal row height before justification, in CSS px. */
	targetRowHeight: number;
	/** Gap between items (and rows), in CSS px. */
	gap: number;
	/**
	 * Hard ceiling on a justified row's height. Prevents a single very-wide
	 * panorama (or a lone item on a row) from ballooning to fill the width.
	 */
	maxRowHeight?: number;
	/** Clamp aspect ratios into [minAspect, maxAspect] so extreme panoramas /
	 * skyscrapers don't dominate a row. */
	minAspect?: number;
	maxAspect?: number;
}

/**
 * Lay items out into justified rows. Returns one entry per row; consumers render
 * each box at its computed `width`/`height`.
 */
export function justifiedLayout<T>(
	items: T[],
	aspectOf: (item: T) => number,
	opts: JustifiedOptions,
): JustifiedRow<T>[] {
	const {
		containerWidth,
		targetRowHeight,
		gap,
		maxRowHeight = targetRowHeight * 1.5,
		minAspect = 0.5,
		maxAspect = 3,
	} = opts;

	const rows: JustifiedRow<T>[] = [];
	if (items.length === 0) return rows;

	// Degenerate container (not measured yet): fall back to natural-height boxes
	// so something still renders instead of collapsing to zero.
	if (!(containerWidth > 0)) {
		return [
			{
				last: true,
				height: targetRowHeight,
				boxes: items.map((item) => {
					const aspect = clampAspect(aspectOf(item), minAspect, maxAspect);
					return { item, aspect, height: targetRowHeight, width: targetRowHeight * aspect };
				}),
			},
		];
	}

	let row: { item: T; aspect: number }[] = [];
	let aspectSum = 0;

	const flush = (last: boolean) => {
		if (row.length === 0) return;
		const totalGap = gap * (row.length - 1);
		const available = containerWidth - totalGap;
		// Height that makes this row span the full width at the items' aspect sum.
		let height = available / aspectSum;
		if (last) {
			// Don't stretch a trailing row full-width — leave it at the target so a
			// single leftover photo isn't blown up. But still cap it.
			height = Math.min(targetRowHeight, maxRowHeight);
		} else {
			height = Math.min(height, maxRowHeight);
		}
		const boxes: JustifiedBox<T>[] = row.map(({ item, aspect }) => ({
			item,
			aspect,
			height,
			width: aspect * height,
		}));
		rows.push({ boxes, height, last });
		row = [];
		aspectSum = 0;
	};

	for (const item of items) {
		const aspect = clampAspect(aspectOf(item), minAspect, maxAspect);
		row.push({ item, aspect });
		aspectSum += aspect;

		// Natural width of the row at the target height; once it meets/exceeds the
		// container, justify and start a new row.
		const totalGap = gap * (row.length - 1);
		const naturalWidth = aspectSum * targetRowHeight + totalGap;
		if (naturalWidth >= containerWidth) flush(false);
	}
	flush(true);
	return rows;
}

function clampAspect(aspect: number, min: number, max: number): number {
	if (!Number.isFinite(aspect) || aspect <= 0) return 1;
	return Math.min(max, Math.max(min, aspect));
}
