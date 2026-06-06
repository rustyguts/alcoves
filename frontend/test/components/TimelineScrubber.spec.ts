import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import TimelineScrubber from "~/components/TimelineScrubber.vue";
import type { TimelineBucket } from "~/composables/useLibraryTimeline";

// Newest-first per-month density buckets spanning three years. Cumulative count
// total = 30, so the 2025 boundary sits at 13/30 and the 2024 boundary at 25/30.
const BUCKETS: TimelineBucket[] = [
  { year: 2026, month: 1, count: 13 },
  { year: 2025, month: 12, count: 8 },
  { year: 2025, month: 7, count: 4 },
  { year: 2024, month: 11, count: 5 },
];

describe("TimelineScrubber", () => {
  it("renders one year label per distinct year, newest-first", () => {
    const wrapper = mount(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
    const years = wrapper.findAll("button").map((b) => b.text());
    expect(years).toEqual(["2026", "2025", "2024"]);
  });

  it("renders one density blip per bucket", () => {
    const wrapper = mount(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
    const blips = wrapper.findAll("span[aria-hidden='true']");
    expect(blips).toHaveLength(BUCKETS.length);
  });

  it("exposes an accessible slider handle reflecting progress", () => {
    const wrapper = mount(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0.5 } });
    const slider = wrapper.get("[role='slider']");
    expect(slider.attributes("aria-valuemin")).toBe("0");
    expect(slider.attributes("aria-valuemax")).toBe("100");
    expect(slider.attributes("aria-valuenow")).toBe("50");
    // aria-valuetext is the period at that fraction (cumulative-count mapping).
    expect(slider.attributes("aria-valuetext")).toBeTruthy();
  });

  it("emits the year's start fraction when a year label is clicked", async () => {
    const wrapper = mount(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
    // Index 1 = the 2025 label, whose range begins at 13/30.
    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.emitted("scrub")?.[0]).toEqual([13 / 30]);
  });

  it("supports keyboard scrubbing (Home / End / arrows)", async () => {
    const wrapper = mount(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0.4 } });
    const slider = wrapper.get("[role='slider']");

    await slider.trigger("keydown", { key: "Home" });
    expect(wrapper.emitted("scrub")?.at(-1)).toEqual([0]);

    await slider.trigger("keydown", { key: "End" });
    expect(wrapper.emitted("scrub")?.at(-1)).toEqual([1]);

    await slider.trigger("keydown", { key: "ArrowDown" });
    // nudge(+0.05) from progress 0.4 → 0.45 (allow float wobble).
    expect(wrapper.emitted("scrub")?.at(-1)?.[0]).toBeCloseTo(0.45, 5);
  });

  it("emits a fraction from the drag position on pointerdown", async () => {
    const wrapper = mount(TimelineScrubber, { props: { buckets: BUCKETS, progress: 0 } });
    const track = wrapper.get(".cursor-ns-resize");
    vi.spyOn(track.element, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 400,
      left: 0,
      right: 56,
      bottom: 400,
      width: 56,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    await track.trigger("pointerdown", { clientY: 200, pointerId: 1 });
    // 200 / 400 = 0.5 down the rail.
    expect(wrapper.emitted("scrub")?.at(-1)).toEqual([0.5]);
  });
});
