import { mount } from "@vue/test-utils";
import LibraryEntriesSkeleton from "~/components/library/LibraryEntriesSkeleton.vue";

describe("LibraryEntriesSkeleton", () => {
  it("renders table skeleton in file mode", () => {
    const wrapper = mount(LibraryEntriesSkeleton, {
      props: { entryViewMode: "file", showTrashed: false },
    });
    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.findAll("tbody tr")).toHaveLength(8);
  });

  it("renders card skeleton in card mode", () => {
    const wrapper = mount(LibraryEntriesSkeleton, {
      props: { entryViewMode: "card", showTrashed: false },
    });
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.find(".grid").exists()).toBe(true);
    expect(wrapper.findAll(".grid > div")).toHaveLength(8);
  });

  it("shows Modified header when not trashed", () => {
    const wrapper = mount(LibraryEntriesSkeleton, {
      props: { entryViewMode: "file", showTrashed: false },
    });
    expect(wrapper.text()).toContain("Modified");
    expect(wrapper.text()).not.toContain("Trashed");
  });

  it("shows Trashed header when showTrashed", () => {
    const wrapper = mount(LibraryEntriesSkeleton, {
      props: { entryViewMode: "file", showTrashed: true },
    });
    expect(wrapper.text()).toContain("Trashed");
  });

  it("renders skeleton divs inside table rows", () => {
    const wrapper = mount(LibraryEntriesSkeleton, {
      props: { entryViewMode: "file", showTrashed: false },
    });
    const skeletons = wrapper.findAll(".u-skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders skeleton divs inside card grid", () => {
    const wrapper = mount(LibraryEntriesSkeleton, {
      props: { entryViewMode: "card", showTrashed: false },
    });
    const skeletons = wrapper.findAll(".u-skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("has table headers including Name, Tags, Owner, Size", () => {
    const wrapper = mount(LibraryEntriesSkeleton, {
      props: { entryViewMode: "file", showTrashed: false },
    });
    expect(wrapper.text()).toContain("Name");
    expect(wrapper.text()).toContain("Tags");
    expect(wrapper.text()).toContain("Owner");
    expect(wrapper.text()).toContain("Size");
  });
});
