import { mount, flushPromises } from "@vue/test-utils";
import PeoplePersonPage from "~/pages/libraries/[id]/people-person.vue";
import type { LibraryPerson, PersonFace } from "~~/shared/types/api";

const mocks = vi.hoisted(() => ({
  routeParamsId: "lib-1",
  routeParamsPersonId: "person-1",
  routerPush: vi.fn(),
  toast: { add: vi.fn() },
  apiFetch: vi.fn(),
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({
      path: `/libraries/${mocks.routeParamsId}/people/${mocks.routeParamsPersonId}`,
      params: { id: mocks.routeParamsId, personId: mocks.routeParamsPersonId },
      query: {},
      fullPath: `/libraries/${mocks.routeParamsId}/people/${mocks.routeParamsPersonId}`,
    }),
    useRouter: () => ({
      push: mocks.routerPush,
      replace: vi.fn(),
      currentRoute: { value: { path: "/", query: {} } },
    }),
  };
});

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  AlcovesImage: {
    template: "<img />",
    props: ["libraryId", "fileId", "alt", "width", "height", "class"],
  },
  AppContextMenu: {
    template: "<div data-stub='context-menu'><slot /></div>",
    props: ["open", "position"],
  },
  FilePreview: {
    template: "<div data-stub='file-preview' />",
    props: ["open", "file", "libraryId", "files"],
  },
};

function makePerson(overrides: Partial<LibraryPerson> = {}): LibraryPerson {
  return {
    id: "person-1",
    libraryId: "lib-1",
    name: "Alice",
    faceCount: 3,
    coverFaceDetectionId: null,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

function makeFace(overrides: Partial<PersonFace> = {}): PersonFace {
  return {
    id: "face-1",
    fileId: "file-1",
    fileName: "photo.jpg",
    boxX: 10,
    boxY: 20,
    boxWidth: 50,
    boxHeight: 60,
    imageWidth: 1920,
    imageHeight: 1080,
    confidence: 0.95,
    createdAt: "2024-01-01",
    ...overrides,
  };
}

describe("library people-person page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routeParamsId = "lib-1";
    mocks.routeParamsPersonId = "person-1";
  });

  function mountPage() {
    return mount(PeoplePersonPage, {
      global: { stubs },
    });
  }

  it("shows loading state while fetching", () => {
    // Don't resolve apiFetch
    mocks.apiFetch.mockReturnValue(new Promise(() => {}));
    const wrapper = mountPage();
    // The loading div renders a flex container with justify-center and an AppIcon stub
    expect(wrapper.find(".justify-center").exists()).toBe(true);
    // Person content should not be visible
    expect(wrapper.text()).not.toContain("No faces available");
  });

  it("shows person not found when person is not in API response", async () => {
    mocks.apiFetch.mockResolvedValue([]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Person not found");
  });

  it("renders person name and face count", async () => {
    const person = makePerson({ name: "Alice", faceCount: 3 });
    const faces = [makeFace({ id: "f1" }), makeFace({ id: "f2" }), makeFace({ id: "f3" })];
    mocks.apiFetch.mockResolvedValueOnce([person]).mockResolvedValueOnce(faces);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Alice");
    expect(wrapper.text()).toContain("3 faces");
  });

  it("shows 'Unnamed person' for person without name", async () => {
    const person = makePerson({ name: null });
    mocks.apiFetch.mockResolvedValueOnce([person]).mockResolvedValueOnce([makeFace()]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("Unnamed person");
  });

  it("renders face grid with AlcovesImage for each face", async () => {
    const person = makePerson();
    const faces = [makeFace({ id: "f1" }), makeFace({ id: "f2" })];
    mocks.apiFetch.mockResolvedValueOnce([person]).mockResolvedValueOnce(faces);
    const wrapper = mountPage();
    await flushPromises();
    const images = wrapper.findAll("img");
    expect(images).toHaveLength(2);
  });

  it("shows empty state when person has no faces", async () => {
    const person = makePerson({ faceCount: 0 });
    mocks.apiFetch.mockResolvedValueOnce([person]).mockResolvedValueOnce([]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("No faces available");
  });

  it("navigates back to people page on back button click", async () => {
    mocks.apiFetch.mockResolvedValueOnce([makePerson()]).mockResolvedValueOnce([makeFace()]);
    const wrapper = mountPage();
    await flushPromises();
    const backBtn = wrapper.findAll("button").find((b) => b.text().includes("Back"));
    await backBtn!.trigger("click");
    expect(mocks.routerPush).toHaveBeenCalledWith("/libraries/lib-1/people");
  });

  it("shows toast on fetch failure", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new Error("Network error"));
    const _wrapper = mountPage();
    await flushPromises();
    expect(mocks.toast.add).toHaveBeenCalledWith({
      title: "Failed to load person",
      color: "error",
    });
  });

  it("uses singular 'face' when there is exactly 1 face", async () => {
    const person = makePerson({ faceCount: 1 });
    mocks.apiFetch.mockResolvedValueOnce([person]).mockResolvedValueOnce([makeFace()]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain("1 face");
    expect(wrapper.text()).not.toContain("1 faces");
  });

  it("shows back to people button when person not found", async () => {
    mocks.apiFetch.mockResolvedValue([]);
    const wrapper = mountPage();
    await flushPromises();
    const btn = wrapper.findAll("button").find((b) => b.text().includes("Back to People"));
    expect(btn).toBeDefined();
  });
});
