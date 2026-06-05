import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import SidebarLibraryNav from "~/components/SidebarLibraryNav.vue";
import type { AuthUser, Library } from "~~/shared/types/api";

interface NavItem {
  label?: string;
  to?: string;
  children?: NavItem[];
  type?: string;
}

// Capture every `items` array handed to a UNavigationMenu so we can assert on
// the nested children the real (stubbed) component would otherwise hide.
let captured: NavItem[][] = [];

const NavStub = defineComponent({
  name: "UNavigationMenu",
  props: ["items"],
  setup(props) {
    captured.push(props.items as NavItem[]);
    return () => h("nav");
  },
});

const ButtonStub = defineComponent({
  name: "UButton",
  emits: ["click"],
  setup(_, { emit, slots }) {
    return () => h("button", { onClick: () => emit("click") }, slots.default?.());
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
      stubs: { UNavigationMenu: NavStub, UButton: ButtonStub, USeparator: true },
    },
  });
}

function flatItems(): NavItem[] {
  return captured.flat();
}

function childLabels(libraryLabelFragment: string): string[] {
  const item = flatItems().find((i) => i.label?.includes(libraryLabelFragment));
  return (item?.children ?? []).map((c) => c.label ?? "");
}

describe("SidebarLibraryNav", () => {
  it("renders the default library separately from the rest", () => {
    mountNav(
      [
        lib({ id: "def", name: "My Files", isDefault: true, ownerId: "owner-x" }),
        lib({ id: "lib-2", name: "Projects" }),
      ],
      owner,
    );
    const labels = flatItems().map((i) => i.label);
    expect(labels).toContain("My Files");
    expect(labels).toContain("Projects");
  });

  it("nests every section under a library, Files first and Trash last", () => {
    mountNav([lib({ name: "Projects" })], owner);
    const children = childLabels("Projects");
    expect(children[0]).toBe("Files");
    expect(children.at(-1)).toBe("Trash");
    expect(children).toEqual(expect.arrayContaining(["Timeline", "Map", "Tags", "Feed"]));
  });

  it("includes People/Objects only when their detection flags are enabled", () => {
    mountNav(
      [lib({ name: "AI Lib", faceRecognitionEnabled: true, objectDetectionEnabled: true })],
      owner,
    );
    expect(childLabels("AI Lib")).toEqual(expect.arrayContaining(["People", "Objects"]));

    mountNav([lib({ name: "Plain Lib" })], owner);
    const plain = childLabels("Plain Lib");
    expect(plain).not.toContain("People");
    expect(plain).not.toContain("Objects");
  });

  it("shows Settings only to a user who can manage the library", () => {
    // Owner of the library (matched by ownerId) can manage.
    mountNav([lib({ name: "Owned", ownerId: "owner-x" })], owner);
    expect(childLabels("Owned")).toContain("Settings");

    // A viewer on someone else's library cannot.
    mountNav([lib({ name: "Foreign", ownerId: "someone-else", currentUserRole: "viewer" })], owner);
    expect(childLabels("Foreign")).not.toContain("Settings");
  });

  it("marks each library as a collapsible trigger linking to its Files", () => {
    mountNav([lib({ id: "lib-9", name: "Trig" })], owner);
    const item = flatItems().find((i) => i.label?.includes("Trig"));
    expect(item?.type).toBe("trigger");
    expect(item?.to).toBe("/libraries/lib-9");
  });

  it("emits create when the add button is clicked", async () => {
    const wrapper = mountNav([lib({ name: "Projects" })], owner);
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("create")).toBeTruthy();
  });

  it("shows Admin only for owner-role users", () => {
    mountNav([lib({ name: "Projects" })], owner);
    expect(flatItems().some((i) => i.label === "Admin")).toBe(true);

    mountNav([lib({ name: "Projects" })], { ...owner, role: "member" });
    expect(flatItems().some((i) => i.label === "Admin")).toBe(false);
  });
});
