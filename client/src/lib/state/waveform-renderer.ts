import { browser } from '$app/environment';

/**
 * A minimal subset of `CanvasRenderingContext2D` that {@link drawWaveform}
 * actually touches. Declaring it explicitly keeps the pure draw function
 * node-testable with a stub object that records calls.
 */
export interface WaveformCtx {
	fillStyle: string;
	setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
	fillRect(x: number, y: number, w: number, h: number): void;
	clearRect(x: number, y: number, w: number, h: number): void;
	beginPath(): void;
	rect(x: number, y: number, w: number, h: number): void;
	fill(): void;
}

export interface DrawWaveformOptions {
	peaks: number[] | null | undefined;
	peaksPerSecond: number;
	pxPerSec: number;
	scrollLeft: number;
	/** Logical (CSS-pixel) viewport width. */
	width: number;
	/** Logical (CSS-pixel) height. */
	height: number;
	color?: string;
	bgColor?: string;
}

const DEFAULT_COLOR = 'rgba(59, 130, 246, 0.85)';
const DEFAULT_BG = 'transparent';

/**
 * Pure waveform painter. Draws mirrored audio peaks onto a 2D context that has
 * already been sized to `width`×`height` logical pixels (the transform is reset
 * here, so the caller only needs to supply the device-pixel-ratio scale). One
 * `rect` is emitted per visible pixel column; the column's bar height is the max
 * peak of the samples that fall under it, mirrored about the vertical midline.
 *
 * No DOM access — only the supplied `ctx` is touched — so it is unit-testable
 * with a stub context in the node project.
 */
export function drawWaveform(ctx: WaveformCtx, opts: DrawWaveformOptions, dpr = 1): void {
	const w = Math.max(0, Math.floor(opts.width));
	const h = Math.max(0, Math.floor(opts.height));
	if (w === 0 || h === 0) return;

	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	const bgColor = opts.bgColor ?? DEFAULT_BG;
	if (bgColor !== 'transparent') {
		ctx.fillStyle = bgColor;
		ctx.fillRect(0, 0, w, h);
	} else {
		ctx.clearRect(0, 0, w, h);
	}

	const arr = opts.peaks;
	if (!arr || arr.length === 0) return;
	const pps = opts.peaksPerSecond;
	const ppsec = opts.pxPerSec;
	if (pps <= 0 || ppsec <= 0) return;

	const mid = h / 2;
	ctx.fillStyle = opts.color ?? DEFAULT_COLOR;
	ctx.beginPath();

	const peaksPerPixel = pps / ppsec;
	const startSec = opts.scrollLeft / ppsec;

	for (let col = 0; col < w; col++) {
		const t = startSec + col / ppsec;
		let startIdx = Math.floor(t * pps);
		let endIdx = startIdx + Math.max(1, Math.ceil(peaksPerPixel));
		if (startIdx < 0) startIdx = 0;
		if (endIdx > arr.length) endIdx = arr.length;
		if (startIdx >= arr.length) break;

		let peak = 0;
		for (let i = startIdx; i < endIdx; i++) {
			const v = arr[i];
			if (v != null && v > peak) peak = v;
		}

		const barH = Math.max(1, peak * h);
		ctx.rect(col, mid - barH / 2, 1, barH);
	}
	ctx.fill();
}

export interface WaveformRendererOptions {
	getCanvas: () => HTMLCanvasElement | null;
	getPeaks: () => number[] | null | undefined;
	getPeaksPerSecond: () => number;
	getPxPerSec: () => number;
	getScrollLeft: () => number;
	getViewportWidth: () => number;
	getHeight: () => number;
	color?: string;
	bgColor?: string;
}

/**
 * Renders mirrored audio peaks onto a viewport-sized canvas. The canvas is
 * pinned to the visible scroll viewport (typically via `position: sticky`) and
 * redraws whenever zoom/scroll/peaks change. This avoids the browser canvas
 * size cap at extreme zoom levels.
 *
 * Ported from the Nuxt `useWaveformRenderer` composable. The Vue version took
 * `Ref`s and `watch`ed them to call `draw()`; here the reactive inputs are
 * getter functions and the consuming component runs its own `$effect` over them,
 * calling `redraw()` on change (and once on mount, matching the Vue `immediate`
 * watch). `redraw()` keeps identical sizing + clear-or-paint semantics: it
 * resizes the backing buffer to `viewportWidth`×`height` scaled by
 * `devicePixelRatio`, sets the CSS size, then defers the painting to the pure
 * {@link drawWaveform}.
 */
export function createWaveformRenderer(opts: WaveformRendererOptions) {
	function redraw(): void {
		const el = opts.getCanvas();
		if (!el) return;
		const w = Math.max(0, Math.floor(opts.getViewportWidth()));
		const h = Math.max(0, Math.floor(opts.getHeight()));
		if (w === 0 || h === 0) return;

		const dpr = (browser && window.devicePixelRatio) || 1;
		if (el.width !== w * dpr || el.height !== h * dpr) {
			el.width = w * dpr;
			el.height = h * dpr;
		}
		el.style.width = `${w}px`;
		el.style.height = `${h}px`;

		const ctx = el.getContext('2d') as WaveformCtx | null;
		if (!ctx) return;

		drawWaveform(
			ctx,
			{
				peaks: opts.getPeaks(),
				peaksPerSecond: opts.getPeaksPerSecond(),
				pxPerSec: opts.getPxPerSec(),
				scrollLeft: opts.getScrollLeft(),
				width: w,
				height: h,
				color: opts.color,
				bgColor: opts.bgColor
			},
			dpr
		);
	}

	return { redraw };
}
