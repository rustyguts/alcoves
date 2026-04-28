import { watch, type Ref } from "vue";

interface Options {
  canvas: Ref<HTMLCanvasElement | null>;
  peaks: Ref<number[] | null | undefined>;
  peaksPerSecond: Ref<number>;
  pxPerSec: Ref<number>;
  scrollLeft: Ref<number>;
  viewportWidth: Ref<number>;
  height: Ref<number>;
  color?: string;
  bgColor?: string;
}

/**
 * Renders mirrored audio peaks onto a viewport-sized canvas. The canvas is
 * pinned to the visible scroll viewport (typically via `position: sticky`)
 * and redraws whenever zoom/scroll/peaks change. This avoids the browser
 * canvas size cap at extreme zoom levels.
 */
export function useWaveformRenderer(opts: Options) {
  const {
    canvas,
    peaks,
    peaksPerSecond,
    pxPerSec,
    scrollLeft,
    viewportWidth,
    height,
    color = "rgba(59, 130, 246, 0.85)",
    bgColor = "transparent",
  } = opts;

  function draw() {
    const el = canvas.value;
    if (!el) return;
    const w = Math.max(0, Math.floor(viewportWidth.value));
    const h = Math.max(0, Math.floor(height.value));
    if (w === 0 || h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (el.width !== w * dpr || el.height !== h * dpr) {
      el.width = w * dpr;
      el.height = h * dpr;
    }
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;

    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (bgColor !== "transparent") {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    const arr = peaks.value;
    if (!arr || arr.length === 0) return;
    const pps = peaksPerSecond.value;
    const ppsec = pxPerSec.value;
    if (pps <= 0 || ppsec <= 0) return;

    const mid = h / 2;
    ctx.fillStyle = color;
    ctx.beginPath();

    const peaksPerPixel = pps / ppsec;
    const startSec = scrollLeft.value / ppsec;

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

  watch(
    [peaks, peaksPerSecond, pxPerSec, scrollLeft, viewportWidth, height],
    () => {
      draw();
    },
    { immediate: true, flush: "post" },
  );

  return { redraw: draw };
}
