import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import HighlightFiltersPanel from "~/components/editor/HighlightFiltersPanel.vue";
import type { HighlightFilter } from "~~/shared/types/api";
import type { FilterAggregate, FilterMatch } from "~/composables/useHighlightFilters";

function makeFilter(over: Partial<HighlightFilter>): HighlightFilter {
  return {
    id: "f1",
    libraryId: "lib1",
    createdById: null,
    name: "Filter",
    expression: "laughter:25",
    proximitySeconds: 5,
    color: "#3B82F6",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const agg = (over: Partial<FilterAggregate> = {}): FilterAggregate => ({
  count: 0,
  meanScore: 0,
  maxScore: 0,
  expressionErrors: [],
  ...over,
});

function mountPanel(over: Record<string, unknown> = {}) {
  return mount(HighlightFiltersPanel, {
    props: {
      filters: [],
      matches: {},
      aggregates: {},
      hasSignals: true,
      ...over,
    },
  });
}

const open = async (wrapper: ReturnType<typeof mountPanel>) => {
  // first button is the collapsible header toggle
  await wrapper.findAll("button")[0]!.trigger("click");
};

describe("HighlightFiltersPanel", () => {
  it("renders nothing without signals and without filters", () => {
    const wrapper = mountPanel({ hasSignals: false, filters: [] });
    expect(wrapper.text()).toBe("");
  });

  it("renders when there are signals, collapsed by default", () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain("Highlight filters");
    expect(wrapper.text()).not.toContain("Add filter");
  });

  it("expands to reveal the toolbar", async () => {
    const wrapper = mountPanel();
    await open(wrapper);
    expect(wrapper.text()).toContain("Add filter");
  });

  it("shows Load presets only when there are no filters and emits it", async () => {
    const wrapper = mountPanel({ filters: [] });
    await open(wrapper);
    const presets = wrapper.find("[data-icon='i-lineicons-brush']");
    expect(presets.exists()).toBe(true);
    await presets.trigger("click");
    expect(wrapper.emitted("load-presets")).toHaveLength(1);
  });

  it("opens the add form and emits create with trimmed values", async () => {
    const wrapper = mountPanel();
    await open(wrapper);
    await wrapper.find("[data-icon='i-lineicons-plus']").trigger("click");
    const inputs = wrapper.findAll("input");
    await inputs[0]!.setValue("  Funny  ");
    await inputs[1]!.setValue("  laughter  ");
    await wrapper.findAll("button").find((b) => b.text().trim() === "Save")!.trigger("click");
    expect(wrapper.emitted("create")?.[0]).toEqual([
      { name: "Funny", expression: "laughter", proximitySeconds: 5, color: "#3B82F6" },
    ]);
  });

  it("does not emit create when name or expression is blank", async () => {
    const wrapper = mountPanel();
    await open(wrapper);
    await wrapper.find("[data-icon='i-lineicons-plus']").trigger("click");
    // leave fields blank
    await wrapper.findAll("button").find((b) => b.text().trim() === "Save")!.trigger("click");
    expect(wrapper.emitted("create")).toBeUndefined();
  });

  it("cancels the add form", async () => {
    const wrapper = mountPanel();
    await open(wrapper);
    await wrapper.find("[data-icon='i-lineicons-plus']").trigger("click");
    expect(wrapper.find("input").exists()).toBe(true);
    await wrapper.findAll("button").find((b) => b.text().trim() === "Cancel")!.trigger("click");
    expect(wrapper.text()).toContain("No filters yet");
  });

  it("sorts filters by hit count then name", async () => {
    const filters = [
      makeFilter({ id: "a", name: "Alpha" }),
      makeFilter({ id: "b", name: "Bravo" }),
    ];
    const wrapper = mountPanel({
      filters,
      aggregates: { a: agg({ count: 1 }), b: agg({ count: 5 }) },
    });
    await open(wrapper);
    const names = wrapper.findAll("li code").map((c) => c.text());
    // both share expression, so check the order via the name spans instead
    const nameSpans = wrapper.findAll("li span.font-medium").map((s) => s.text());
    expect(nameSpans).toEqual(["Bravo", "Alpha"]);
    expect(names).toHaveLength(2);
  });

  it("shows aggregate hit stats", async () => {
    const wrapper = mountPanel({
      filters: [makeFilter({ id: "a" })],
      aggregates: { a: agg({ count: 3, meanScore: 0.5, maxScore: 0.9 }) },
    });
    await open(wrapper);
    expect(wrapper.text()).toContain("3 hits");
    expect(wrapper.text()).toContain("avg 50%");
    expect(wrapper.text()).toContain("max 90%");
  });

  it("flags a parse error from the aggregate", async () => {
    const wrapper = mountPanel({
      filters: [makeFilter({ id: "a" })],
      aggregates: { a: agg({ expressionErrors: ["bad token"] }) },
    });
    await open(wrapper);
    expect(wrapper.text()).toContain("parse error");
  });

  it("expands a filter to show matches and seeks on click", async () => {
    const matches: Record<string, FilterMatch[]> = {
      a: [{ filterId: "a", startSeconds: 65, endSeconds: 67, score: 0.8, evidence: ["laughter"] }],
    };
    const wrapper = mountPanel({
      filters: [makeFilter({ id: "a" })],
      matches,
      aggregates: { a: agg({ count: 1 }) },
    });
    await open(wrapper);
    // the per-filter expand toggle is the first button inside the row
    const rowToggle = wrapper.find("li button");
    await rowToggle.trigger("click");
    const matchBtn = wrapper.findAll("li button").find((b) => b.text().includes("1:05"));
    expect(matchBtn).toBeTruthy();
    await matchBtn!.trigger("click");
    expect(wrapper.emitted("seek")?.[0]).toEqual([65]);
  });

  it("opens the edit form and emits update", async () => {
    const wrapper = mountPanel({
      filters: [makeFilter({ id: "a", name: "Orig", expression: "laughter" })],
      aggregates: { a: agg() },
    });
    await open(wrapper);
    await wrapper.find("[data-icon='i-lineicons-pencil']").trigger("click");
    const inputs = wrapper.findAll("input");
    await inputs[0]!.setValue("Updated");
    await wrapper.findAll("button").find((b) => b.text().trim() === "Save")!.trigger("click");
    const update = wrapper.emitted("update") as Array<[string, { name: string }]> | undefined;
    expect(update?.[0]?.[0]).toBe("a");
    expect(update![0]![1].name).toBe("Updated");
  });

  it("cancels the edit form", async () => {
    const wrapper = mountPanel({
      filters: [makeFilter({ id: "a", name: "Orig" })],
      aggregates: { a: agg() },
    });
    await open(wrapper);
    await wrapper.find("[data-icon='i-lineicons-pencil']").trigger("click");
    await wrapper.findAll("button").find((b) => b.text().trim() === "Cancel")!.trigger("click");
    expect(wrapper.emitted("update")).toBeUndefined();
  });

  it("emits remove when the trash button is clicked", async () => {
    const wrapper = mountPanel({
      filters: [makeFilter({ id: "a" })],
      aggregates: { a: agg() },
    });
    await open(wrapper);
    await wrapper.find("[data-icon='i-lineicons-trash-can']").trigger("click");
    expect(wrapper.emitted("remove")?.[0]).toEqual(["a"]);
  });
});
