import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import LibrarySwitcher from "~/components/LibrarySwitcher.vue";
import type { Library } from "~~/shared/types/api";

interface MenuItem {
  label?: string;
  slot?: string;
  onSelect?: (e: Event) => void;
}

let captured: MenuItem[][][] = [];

// UDropdownMenu stub: record the grouped `items` and render the trigger slot so
// we can assert on both the menu structure and the current-library label.
const DropdownStub = defineComponent({
  name: "UDropdownMenu",
  props: ["items", "content", "ui"],
  setup(props, { slots }) {
    captured.push(props.items as MenuItem[][]);
    return () => h("div", { class: "dd" }, slots.default?.());
  },
});

function lib(over: Partial<Library>): Library {
  return {
    id: "lib-1",
    name: "Library One",
    emoji: null,
    isDefault: false,
    faceRecognitionEnabled: false,
    objectDetectionEnabled: false,
    sharingEnabled: false,
    ownerId: "owner-x",
    currentUserRole: "viewer",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function mountSwitcher(libraries: Library[] | null, currentLibraryId: string | null) {
  captured = [];
  return mount(LibrarySwitcher, {
    props: { libraries, currentLibraryId },
    global: { stubs: { UDropdownMenu: DropdownStub, UIcon: true } },
  });
}

function groups(): MenuItem[][] {
  return captured[0] ?? [];
}

describe("LibrarySwitcher", () => {
  it("shows the current library in the trigger", () => {
    const wrapper = mountSwitcher(
      [lib({ id: "def", name: "Home", isDefault: true }), lib({ id: "lib-2", name: "Projects" })],
      "lib-2",
    );
    expect(wrapper.text()).toContain("Projects");
  });

  it("falls back to the default library when none is current", () => {
    const wrapper = mountSwitcher(
      [lib({ id: "def", name: "Home", isDefault: true }), lib({ id: "lib-2", name: "Projects" })],
      null,
    );
    expect(wrapper.text()).toContain("Home");
  });

  it("pins the default library to the top group and lists others below", () => {
    mountSwitcher(
      [lib({ id: "lib-b", name: "Beta" }), lib({ id: "def", name: "Home", isDefault: true }), lib({ id: "lib-a", name: "Alpha" })],
      "def",
    );
    const g = groups();
    // First group is the default library on its own.
    expect(g[0]?.map((i) => i.label)).toEqual(["Home"]);
    // Second group is the others, sorted by name.
    expect(g[1]?.map((i) => i.label)).toEqual(["Alpha", "Beta"]);
    // Last group is the create action.
    expect(g.at(-1)?.map((i) => i.label)).toEqual(["New library"]);
  });

  it("marks the current library with the active slot", () => {
    mountSwitcher(
      [lib({ id: "def", name: "Home", isDefault: true }), lib({ id: "lib-2", name: "Projects" })],
      "lib-2",
    );
    const all = groups().flat();
    const current = all.find((i) => i.label === "Projects");
    const otherLib = all.find((i) => i.label === "Home");
    expect(current?.slot).toBe("active");
    expect(otherLib?.slot).toBeUndefined();
  });

  it("emits create when the New library action is selected", () => {
    const wrapper = mountSwitcher([lib({ id: "def", isDefault: true })], "def");
    const createItem = groups()
      .flat()
      .find((i) => i.label === "New library");
    createItem?.onSelect?.(new Event("click"));
    expect(wrapper.emitted("create")).toBeTruthy();
  });
});
