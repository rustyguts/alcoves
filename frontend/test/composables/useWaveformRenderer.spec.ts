import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useWaveformRenderer } from "~/composables/useWaveformRenderer";

interface FakeCtx {
  setTransform: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillStyle: string;
}

function makeCanvas(): { el: HTMLCanvasElement; ctx: FakeCtx } {
  const ctx: FakeCtx = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    fillStyle: "",
  };
  const el = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: vi.fn(() => ctx),
  } as unknown as HTMLCanvasElement;
  return { el, ctx };
}

describe("useWaveformRenderer", () => {
  beforeEach(() => {
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  });

  it("noops when canvas is null", async () => {
    const peaks = ref<number[]>([0.1, 0.2]);
    useWaveformRenderer({
      canvas: ref(null),
      peaks,
      peaksPerSecond: ref(50),
      pxPerSec: ref(100),
      scrollLeft: ref(0),
      viewportWidth: ref(200),
      height: ref(40),
    });
    await nextTick();
    expect(true).toBe(true); // no throw
  });

  it("draws one rect per visible pixel column when peaks exist", async () => {
    const { el, ctx } = makeCanvas();
    const canvas = ref(el);
    useWaveformRenderer({
      canvas,
      peaks: ref([0.1, 0.5, 0.9, 0.4]),
      peaksPerSecond: ref(50),
      pxPerSec: ref(50), // 1 peak per pixel
      scrollLeft: ref(0),
      viewportWidth: ref(4),
      height: ref(40),
    });
    await nextTick();
    await nextTick();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.rect).toHaveBeenCalledTimes(4);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("clears + bails when peaks are empty", async () => {
    const { el, ctx } = makeCanvas();
    useWaveformRenderer({
      canvas: ref(el),
      peaks: ref<number[]>([]),
      peaksPerSecond: ref(50),
      pxPerSec: ref(50),
      scrollLeft: ref(0),
      viewportWidth: ref(10),
      height: ref(40),
    });
    await nextTick();
    await nextTick();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.rect).not.toHaveBeenCalled();
  });

  it("redraws when scrollLeft changes", async () => {
    const { el, ctx } = makeCanvas();
    const scrollLeft = ref(0);
    useWaveformRenderer({
      canvas: ref(el),
      peaks: ref([0.1, 0.5, 0.9, 0.4, 0.7, 0.2]),
      peaksPerSecond: ref(50),
      pxPerSec: ref(50),
      scrollLeft,
      viewportWidth: ref(2),
      height: ref(40),
    });
    await nextTick();
    await nextTick();
    const before = ctx.rect.mock.calls.length;
    scrollLeft.value = 1;
    await nextTick();
    await nextTick();
    expect(ctx.rect.mock.calls.length).toBeGreaterThan(before);
  });

  it("respects devicePixelRatio when sizing the backing buffer", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    const { el } = makeCanvas();
    useWaveformRenderer({
      canvas: ref(el),
      peaks: ref([0.5]),
      peaksPerSecond: ref(50),
      pxPerSec: ref(50),
      scrollLeft: ref(0),
      viewportWidth: ref(10),
      height: ref(40),
    });
    await nextTick();
    await nextTick();
    expect(el.width).toBe(20);
    expect(el.height).toBe(80);
  });
});
