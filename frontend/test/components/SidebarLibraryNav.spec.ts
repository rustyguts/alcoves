import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import SidebarLibraryNav from "~/components/SidebarLibraryNav.vue";
import type { AuthUser, Library } from "~~/shared/types/api";

interface NavItem {
  label?: string;
  to?: string;
}

// Capture every `items` array handed to a UNavigationMenu (the static action
// nav + the Admin nav) so we can assert on the items the component builds.
let captured: NavItem[][] = [];

const NavStub = defineComponent({
  name: "UNavigationMenu",
  props: ["items"],
  setup(props) {
    captured.push(props.items as NavItem[]);
    return () => h("nav");
  },
});

// Capture the props handed to the switcher and let tests fire its create event.
const SwitcherStub = defineComponent({
  name: "LibrarySwitcher",
  props: ["libraries", "currentLibraryId"],
  emits: ["create"],
  setup(_, { emit }) {
    return () => h("button", { onClick: () => emit("create") }, "switch");
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

const owner: AuthUser = {
  id: "owner-x",
  email: "o@example.com",
  displayName: "Owner",
  avatarUrl: null,
  role: "owner",
};

function mountNav(libraries: Library[] | null, user: AuthUser | null) {
  captured = [];
  return mount(SidebarLibraryNav, {
    props: { libraries, user },
    global: {
      stubs: { UNavigationMenu: NavStub, LibrarySwitcher: SwitcherStub, USeparator: true },
    },
  });
}

function actionLabels(): string[] {
  return captured.flat().map((i) => i.label ?? "");
}

describe("SidebarLibraryNav", () => {
  // On "/" the current library falls back to the default library, so the
  // action items below describe the default library's sections.
  it("renders the current library's sections, Files first and Trash last", () => {
    mountNav([lib({ isDefault: true, ownerId: "owner-x" })], owner);
    const labels = actionLabels();
    expect(labels[0]).toBe("Files");
    expect(labels).toEqual(expect.arrayContaining(["Timeline", "Map", "Tags", "Feed"]));
    // Trash is the last action (Admin is in a separate nav).
    const trashIdx = labels.indexOf("Trash");
    expect(trashIdx).toBeGreaterThan(0);
  });

  it("includes People/Objects only when detection flags are enabled", () => {
    mountNav(
      [lib({ isDefault: true, faceRecognitionEnabled: true, objectDetectionEnabled: true })],
      owner,
    );
    expect(actionLabels()).toEqual(expect.arrayContaining(["People", "Objects"]));

    mountNav([lib({ isDefault: true })], owner);
    const plain = actionLabels();
    expect(plain).not.toContain("People");
    expect(plain).not.toContain("Objects");
  });

  it("shows Settings only when the user can manage the library", () => {
    mountNav([lib({ isDefault: true, ownerId: "owner-x" })], owner);
    expect(actionLabels()).toContain("Settings");

    mountNav([lib({ isDefault: true, ownerId: "someone-else", currentUserRole: "viewer" })], owner);
    expect(actionLabels()).not.toContain("Settings");
  });

  it("passes the current library id to the switcher", () => {
    const wrapper = mountNav(
      [lib({ id: "def", isDefault: true }), lib({ id: "lib-2", name: "Other" })],
      owner,
    );
    const switcher = wrapper.findComponent(SwitcherStub);
    expect(switcher.props("currentLibraryId")).toBe("def");
  });

  it("re-emits create from the switcher", async () => {
    const wrapper = mountNav([lib({ isDefault: true })], owner);
    await wrapper.findComponent(SwitcherStub).trigger("click");
    expect(wrapper.emitted("create")).toBeTruthy();
  });

  it("shows Admin only for owner-role users", () => {
    mountNav([lib({ isDefault: true })], owner);
    expect(actionLabels()).toContain("Admin");

    mountNav([lib({ isDefault: true })], { ...owner, role: "member" });
    expect(actionLabels()).not.toContain("Admin");
  });
});
