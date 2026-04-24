import { mount } from "@vue/test-utils";
import PeoplePage from "~/pages/libraries/[id]/people.vue";

function mockRef<T>(get: () => T, set?: (value: T) => void) {
  return {
    __v_isRef: true as const,
    get value() {
      return get();
    },
    set value(v: T) {
      set?.(v);
    },
  };
}

const mocks = vi.hoisted(() => ({
  library: {
    id: "lib-1",
    name: "Test Library",
    emoji: null,
    isDefault: false,
    faceRecognitionEnabled: true,
    ownerId: "user-1",
    currentUserRole: "owner",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  },
  routeParamsId: "lib-1",
  routerPush: vi.fn(),
  refreshLibraries: vi.fn(),
  // useLibraryPeople return values
  people: [] as Array<{ id: string; name: string | null; faceCount: number }>,
  peopleLoading: false,
  selectedPeople: new Set<string>(),
  fetchPeople: vi.fn(),
  renamePerson: vi.fn(),
  mergePeople: vi.fn(),
  togglePersonSelection: vi.fn(),
  getPersonThumbnailUrl: vi.fn(() => "/thumb.jpg"),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({
    data: mockRef(() => mocks.library),
    refresh: vi.fn(),
  }),
}));

vi.mock("~/composables/useLibraryPeople", () => ({
  useLibraryPeople: () => ({
    people: mockRef(() => mocks.people),
    loading: mockRef(() => mocks.peopleLoading),
    selectedPeople: mockRef(() => mocks.selectedPeople),
    fetchPeople: mocks.fetchPeople,
    renamePerson: mocks.renamePerson,
    mergePeople: mocks.mergePeople,
    togglePersonSelection: mocks.togglePersonSelection,
    getPersonThumbnailUrl: mocks.getPersonThumbnailUrl,
  }),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({
      path: `/libraries/${mocks.routeParamsId}/people`,
      params: { id: mocks.routeParamsId },
      query: {},
      fullPath: `/libraries/${mocks.routeParamsId}/people`,
    }),
    useRouter: () => ({
      push: mocks.routerPush,
      replace: vi.fn(),
      currentRoute: { value: { path: `/libraries/${mocks.routeParamsId}/people`, query: {} } },
    }),
  };
});

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

describe("library people page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.people = [];
    mocks.peopleLoading = false;
    mocks.selectedPeople = new Set<string>();
  });

  function mountPage() {
    return mount(PeoplePage, {
      global: {
        stubs,
        provide: {
          refreshLibraries: mocks.refreshLibraries,
        },
      },
    });
  }

  it("calls fetchPeople on mount", () => {
    mountPage();
    expect(mocks.fetchPeople).toHaveBeenCalled();
  });

  it("shows loading spinner when loading", () => {
    mocks.peopleLoading = true;
    const wrapper = mountPage();
    // The component renders an AppIcon stub with an enclosing div containing justify-center
    // Verify the loading state renders the expected container
    expect(wrapper.find(".justify-center").exists()).toBe(true);
    // And the empty state should NOT show
    expect(wrapper.text()).not.toContain("No faces detected yet");
  });

  it("shows empty state when no people detected", () => {
    mocks.people = [];
    mocks.peopleLoading = false;
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("No faces detected yet");
  });

  it("renders person cards when people exist", () => {
    mocks.people = [
      { id: "p1", name: "Alice", faceCount: 5 },
      { id: "p2", name: null, faceCount: 3 },
    ];
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Alice");
    expect(wrapper.text()).toContain("5");
    expect(wrapper.text()).toContain("3");
  });

  it("calls togglePersonSelection on person click", async () => {
    mocks.people = [{ id: "p1", name: "Bob", faceCount: 2 }];
    const wrapper = mountPage();
    const btn = wrapper.find("button[type='button']");
    await btn.trigger("click");
    expect(mocks.togglePersonSelection).toHaveBeenCalledWith("p1");
  });

  it("navigates to person detail on double-click", async () => {
    mocks.people = [{ id: "p1", name: "Bob", faceCount: 2 }];
    const wrapper = mountPage();
    const btn = wrapper.find("button[type='button']");
    await btn.trigger("dblclick");
    expect(mocks.routerPush).toHaveBeenCalledWith("/libraries/lib-1/people/p1");
  });

  it("shows merge button when 2+ people selected", () => {
    mocks.people = [
      { id: "p1", name: "A", faceCount: 1 },
      { id: "p2", name: "B", faceCount: 1 },
    ];
    mocks.selectedPeople = new Set(["p1", "p2"]);
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Merge Selected");
    expect(wrapper.text()).toContain("2 selected");
  });

  it("calls mergePeople on merge button click", async () => {
    mocks.people = [
      { id: "p1", name: "A", faceCount: 1 },
      { id: "p2", name: "B", faceCount: 1 },
    ];
    mocks.selectedPeople = new Set(["p1", "p2"]);
    const wrapper = mountPage();
    const mergeBtn = wrapper.findAll("button").find((b) => b.text().includes("Merge Selected"));
    await mergeBtn!.trigger("click");
    expect(mocks.mergePeople).toHaveBeenCalled();
  });

  it("shows clear button for selection", async () => {
    mocks.people = [
      { id: "p1", name: "A", faceCount: 1 },
      { id: "p2", name: "B", faceCount: 1 },
    ];
    mocks.selectedPeople = new Set(["p1", "p2"]);
    const wrapper = mountPage();
    const clearBtn = wrapper.findAll("button").find((b) => b.text().includes("Clear"));
    expect(clearBtn).toBeDefined();
  });

  it("hides merge UI when fewer than 2 selected", () => {
    mocks.people = [{ id: "p1", name: "A", faceCount: 1 }];
    mocks.selectedPeople = new Set(["p1"]);
    const wrapper = mountPage();
    expect(wrapper.text()).not.toContain("Merge Selected");
  });

  it("applies ring styling to selected person", () => {
    mocks.people = [{ id: "p1", name: "A", faceCount: 1 }];
    mocks.selectedPeople = new Set(["p1"]);
    const wrapper = mountPage();
    const btn = wrapper.find("button[type='button']");
    expect(btn.classes()).toContain("ring-2");
  });

  it("shows rename modal on right-click", async () => {
    mocks.people = [{ id: "p1", name: "Alice", faceCount: 1 }];
    const wrapper = mountPage();
    const btn = wrapper.find("button[type='button']");
    await btn.trigger("contextmenu");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("input[placeholder='e.g. Alex']").exists()).toBe(true);
  });

  it("displays face count badge on person card", () => {
    mocks.people = [{ id: "p1", name: "Alice", faceCount: 42 }];
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("42");
  });

  it("shows unnamed person title for person without name", () => {
    mocks.people = [{ id: "p1", name: null, faceCount: 1 }];
    const wrapper = mountPage();
    const btn = wrapper.find("button[type='button']");
    expect(btn.attributes("title")).toBe("Unnamed person");
  });
});
