import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drawWaveform, createWaveformRenderer, type WaveformCtx } from './waveform-renderer';

vi.mock('$app/environment', () => ({ browser: true }));

type FakeCtx = WaveformCtx & {
	setTransform: ReturnType<typeof vi.fn>;
	fillRect: ReturnType<typeof vi.fn>;
	clearRect: ReturnType<typeof vi.fn>;
	beginPath: ReturnType<typeof vi.fn>;
	rect: ReturnType<typeof vi.fn>;
	fill: ReturnType<typeof vi.fn>;
};

function makeCtx(): FakeCtx {
	return {
		fillStyle: '',
		setTransform: vi.fn(),
		fillRect: vi.fn(),
		clearRect: vi.fn(),
		beginPath: vi.fn(),
		rect: vi.fn(),
		fill: vi.fn()
	} as unknown as FakeCtx;
}

function makeCanvas(ctx: FakeCtx | null): HTMLCanvasElement {
	return {
		width: 0,
		height: 0,
		style: {} as CSSStyleDeclaration,
		getContext: vi.fn(() => ctx)
	} as unknown as HTMLCanvasElement;
}

describe('drawWaveform', () => {
	it('draws one rect per visible pixel column when peaks exist', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [0.1, 0.5, 0.9, 0.4],
			peaksPerSecond: 50,
			pxPerSec: 50, // 1 peak per pixel
			scrollLeft: 0,
			width: 4,
			height: 40
		});
		expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
		expect(ctx.beginPath).toHaveBeenCalled();
		expect(ctx.rect).toHaveBeenCalledTimes(4);
		expect(ctx.fill).toHaveBeenCalled();
	});

	it('mirrors bars about the vertical midline', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [0.5],
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 1,
			height: 40
		});
		// peak 0.5 * height 40 = 20; mid 20; y = 20 - 10 = 10, h = 20
		expect(ctx.rect).toHaveBeenCalledWith(0, 10, 1, 20);
	});

	it('enforces a minimum bar height of 1px', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [0],
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 1,
			height: 40
		});
		// peak 0 -> barH max(1, 0) = 1; y = 20 - 0.5
		expect(ctx.rect).toHaveBeenCalledWith(0, 19.5, 1, 1);
	});

	it('clears (transparent bg) and bails when peaks are empty', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [],
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 10,
			height: 40
		});
		expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 10, 40);
		expect(ctx.rect).not.toHaveBeenCalled();
		expect(ctx.fillRect).not.toHaveBeenCalled();
	});

	it('paints a background rect when bgColor is not transparent', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: null,
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 10,
			height: 40,
			bgColor: '#000'
		});
		expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 10, 40);
		expect(ctx.clearRect).not.toHaveBeenCalled();
		expect(ctx.rect).not.toHaveBeenCalled();
	});

	it('uses a custom fill color for the bars', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [0.5],
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 1,
			height: 40,
			color: '#abc'
		});
		expect(ctx.fillStyle).toBe('#abc');
	});

	it('bails early on zero width or height', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [0.5],
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 0,
			height: 40
		});
		drawWaveform(ctx, {
			peaks: [0.5],
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 10,
			height: 0
		});
		expect(ctx.setTransform).not.toHaveBeenCalled();
		expect(ctx.clearRect).not.toHaveBeenCalled();
	});

	it('bails after clearing when peaksPerSecond or pxPerSec is non-positive', () => {
		const a = makeCtx();
		drawWaveform(a, {
			peaks: [0.5],
			peaksPerSecond: 0,
			pxPerSec: 50,
			scrollLeft: 0,
			width: 10,
			height: 40
		});
		expect(a.clearRect).toHaveBeenCalled();
		expect(a.rect).not.toHaveBeenCalled();

		const b = makeCtx();
		drawWaveform(b, {
			peaks: [0.5],
			peaksPerSecond: 50,
			pxPerSec: 0,
			scrollLeft: 0,
			width: 10,
			height: 40
		});
		expect(b.rect).not.toHaveBeenCalled();
	});

	it('breaks out of the loop once the scroll offset is past all peaks', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [0.5, 0.5],
			peaksPerSecond: 50,
			pxPerSec: 50,
			scrollLeft: 1000, // startSec well beyond peaks
			width: 10,
			height: 40
		});
		expect(ctx.rect).not.toHaveBeenCalled();
		expect(ctx.fill).toHaveBeenCalled();
	});

	it('clamps the sample window to array bounds (multiple peaks per pixel)', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [0.1, 0.9, 0.3, 0.2],
			peaksPerSecond: 100,
			pxPerSec: 50, // 2 peaks per pixel
			scrollLeft: 0,
			width: 3,
			height: 40
		});
		// col 0 -> idx 0..2 max 0.9; col 1 -> idx 2..4 max 0.3; col 2 -> idx 4 >= len, break
		expect(ctx.rect).toHaveBeenCalledTimes(2);
		expect(ctx.rect).toHaveBeenNthCalledWith(1, 0, 20 - (0.9 * 40) / 2, 1, 0.9 * 40);
	});

	it('ignores null/undefined samples when computing the column peak', () => {
		const ctx = makeCtx();
		drawWaveform(ctx, {
			peaks: [null as unknown as number, 0.4],
			peaksPerSecond: 100,
			pxPerSec: 50, // 2 peaks per pixel, col 0 -> idx 0..2
			scrollLeft: 0,
			width: 1,
			height: 40
		});
		// max of (null,0.4) = 0.4 -> barH 16, y = 20 - 8 = 12
		expect(ctx.rect).toHaveBeenCalledWith(0, 12, 1, 16);
	});

	it('applies the supplied devicePixelRatio to the transform', () => {
		const ctx = makeCtx();
		drawWaveform(
			ctx,
			{ peaks: [0.5], peaksPerSecond: 50, pxPerSec: 50, scrollLeft: 0, width: 1, height: 40 },
			2
		);
		expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
	});
});

describe('createWaveformRenderer', () => {
	beforeEach(() => {
		vi.stubGlobal('window', { devicePixelRatio: 1 });
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function baseOpts(canvas: HTMLCanvasElement | null) {
		return {
			getCanvas: () => canvas,
			getPeaks: () => [0.1, 0.5, 0.9, 0.4] as number[],
			getPeaksPerSecond: () => 50,
			getPxPerSec: () => 50,
			getScrollLeft: () => 0,
			getViewportWidth: () => 4,
			getHeight: () => 40
		};
	}

	it('noops when canvas is null', () => {
		const r = createWaveformRenderer(baseOpts(null));
		expect(() => r.redraw()).not.toThrow();
	});

	it('noops when viewport width or height is zero', () => {
		const ctx = makeCtx();
		const el = makeCanvas(ctx);
		const r = createWaveformRenderer({ ...baseOpts(el), getViewportWidth: () => 0 });
		r.redraw();
		expect(el.getContext).not.toHaveBeenCalled();
		expect(ctx.rect).not.toHaveBeenCalled();
	});

	it('draws one rect per visible pixel column when peaks exist', () => {
		const ctx = makeCtx();
		const el = makeCanvas(ctx);
		const r = createWaveformRenderer(baseOpts(el));
		r.redraw();
		expect(ctx.beginPath).toHaveBeenCalled();
		expect(ctx.rect).toHaveBeenCalledTimes(4);
		expect(ctx.fill).toHaveBeenCalled();
	});

	it('clears + bails when peaks are empty', () => {
		const ctx = makeCtx();
		const el = makeCanvas(ctx);
		const r = createWaveformRenderer({
			...baseOpts(el),
			getPeaks: () => [] as number[],
			getViewportWidth: () => 10
		});
		r.redraw();
		expect(ctx.clearRect).toHaveBeenCalled();
		expect(ctx.rect).not.toHaveBeenCalled();
	});

	it('redraws more rects after scrollLeft advances into more peaks', () => {
		const ctx = makeCtx();
		const el = makeCanvas(ctx);
		let scroll = 0;
		const r = createWaveformRenderer({
			...baseOpts(el),
			getPeaks: () => [0.1, 0.5, 0.9, 0.4, 0.7, 0.2] as number[],
			getViewportWidth: () => 2,
			getScrollLeft: () => scroll
		});
		r.redraw();
		const before = ctx.rect.mock.calls.length;
		scroll = 1;
		r.redraw();
		expect(ctx.rect.mock.calls.length).toBeGreaterThan(before);
	});

	it('sizes the backing buffer by devicePixelRatio and sets CSS size', () => {
		vi.stubGlobal('window', { devicePixelRatio: 2 });
		const ctx = makeCtx();
		const el = makeCanvas(ctx);
		const r = createWaveformRenderer({
			...baseOpts(el),
			getPeaks: () => [0.5] as number[],
			getViewportWidth: () => 10
		});
		r.redraw();
		expect(el.width).toBe(20);
		expect(el.height).toBe(80);
		expect(el.style.width).toBe('10px');
		expect(el.style.height).toBe('40px');
	});

	it('does not resize the backing buffer when already correctly sized', () => {
		const ctx = makeCtx();
		const el = makeCanvas(ctx);
		el.width = 4;
		el.height = 40;
		const r = createWaveformRenderer(baseOpts(el));
		r.redraw();
		// unchanged (no reassignment path), still drew
		expect(el.width).toBe(4);
		expect(ctx.rect).toHaveBeenCalled();
	});

	it('noops when getContext returns null', () => {
		const el = makeCanvas(null);
		const r = createWaveformRenderer(baseOpts(el));
		expect(() => r.redraw()).not.toThrow();
		expect(el.getContext).toHaveBeenCalledWith('2d');
	});

	it('falls back to dpr 1 when window has no devicePixelRatio', () => {
		vi.stubGlobal('window', {});
		const ctx = makeCtx();
		const el = makeCanvas(ctx);
		const r = createWaveformRenderer({
			...baseOpts(el),
			getPeaks: () => [0.5] as number[],
			getViewportWidth: () => 10
		});
		r.redraw();
		expect(el.width).toBe(10);
		expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
	});
});
