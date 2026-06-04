import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MomentsList from "~/components/editor/MomentsList.vue";
import type { Moment } from "~~/shared/types/api";

function makeMoment(over: Partial<Moment>): Moment {
  return {
    id: "m1",
    libraryId: "lib1",
    fileId: "file1",
    name: "Clip",
    startSeconds: 0,
    endSeconds: 1,
    exportStatus: null,
    exportProgress: null,
    tags: [],
    ...over,
  } as Moment;
}

describe("MomentsList", () => {
  it("shows an empty state when there are no moments", () => {
    const wrapper = mount(MomentsList, { props: { moments: [], selectedId: null } });
    expect(wrapper.text()).toContain("No moments yet");
  });

  it("renders moments sorted by startSeconds with a count", () => {
    const wrapper = mount(MomentsList, {
      props: {
        moments: [
          makeMoment({ id: "late", name: "Late", startSeconds: 10, endSeconds: 12 }),
          makeMoment({ id: "early", name: "Early", startSeconds: 1, endSeconds: 2 }),
        ],
        selectedId: null,
      },
    });
    const items = wrapper.findAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toContain("Early");
    expect(items[1]!.text()).toContain("Late");
    expect(wrapper.text()).toContain("2");
  });

  it("shows the duration and range for a moment", () => {
    const wrapper = mount(MomentsList, {
      props: {
        moments: [makeMoment({ startSeconds: 1.2, endSeconds: 3.7 })],
        selectedId: null,
      },
    });
    expect(wrapper.text()).toContain("1.2s – 3.7s");
    expect(wrapper.text()).toContain("2.50s");
  });

  it("falls back to 'Untitled' when a moment has no name", () => {
    const wrapper = mount(MomentsList, {
      props: { moments: [makeMoment({ name: "" })], selectedId: null },
    });
    expect(wrapper.text()).toContain("Untitled");
  });

  it("emits select with the moment id on click", async () => {
    const wrapper = mount(MomentsList, {
      props: { moments: [makeMoment({ id: "abc" })], selectedId: null },
    });
    await wrapper.find("li [role='button']").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["abc"]]);
  });

  it.each([
    ["queued", "queued"],
    ["ready", "ready"],
    ["failed", "failed"],
  ] as const)("renders the %s status badge", (status, label) => {
    const wrapper = mount(MomentsList, {
      props: { moments: [makeMoment({ exportStatus: status })], selectedId: null },
    });
    expect(wrapper.text()).toContain(label);
  });

  it("renders processing progress percentage when available", () => {
    const wrapper = mount(MomentsList, {
      props: {
        moments: [makeMoment({ exportStatus: "processing", exportProgress: 42 })],
        selectedId: null,
      },
    });
    expect(wrapper.text()).toContain("42%");
  });

  it("renders a dash when there is no export status", () => {
    const wrapper = mount(MomentsList, {
      props: { moments: [makeMoment({ exportStatus: null })], selectedId: null },
    });
    expect(wrapper.text()).toContain("—");
  });

  it("highlights the selected moment", () => {
    const wrapper = mount(MomentsList, {
      props: { moments: [makeMoment({ id: "sel" })], selectedId: "sel" },
    });
    expect(wrapper.html()).toContain("ring-primary");
  });
});
