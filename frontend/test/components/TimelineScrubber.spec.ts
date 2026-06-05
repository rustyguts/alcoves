import { mount } from "@vue/test-utils";
import TimelineScrubber from "~/components/TimelineScrubber.vue";

const YEARS = [
  { year: 2026, key: "2026-0-14" },
  { year: 2025, key: "2025-11-23" },
  { year: 2024, key: "2024-5-1" },
];

describe("TimelineScrubber", () => {
  it("renders one button per year, newest-first", () => {
    const wrapper = mount(TimelineScrubber, { props: { years: YEARS } });
    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels).toEqual(["2026", "2025", "2024"]);
  });

  it("emits the day key of the clicked year", async () => {
    const wrapper = mount(TimelineScrubber, { props: { years: YEARS } });
    await wrapper.findAll("button")[1]!.trigger("click");
    expect(wrapper.emitted("jump")?.[0]).toEqual(["2025-11-23"]);
  });

  it("renders dotted ticks only between years (n-1 gaps)", () => {
    const wrapper = mount(TimelineScrubber, { props: { years: YEARS } });
    const ticks = wrapper.findAll("[aria-hidden='true']");
    expect(ticks).toHaveLength(YEARS.length - 1);
  });
});
