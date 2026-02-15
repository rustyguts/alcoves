import { mount } from "@vue/test-utils";
import SearchPage from "~/pages/search.vue";
import type { GlobalSearchResponse, GlobalSearchResult } from "~~/shared/types/api";

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
  searchData: { query: "", totalCount: 0, results: [] } as GlobalSearchResponse,
  status: "idle" as string,
  error: null as Error | null,
  execute: vi.fn(),
  mockRouter: { push: vi.fn(), replace: vi.fn() },
  routeQuery: {} as Record<string, string>,
  user: {
    id: "user-1",
    email: "u@example.com",
    displayName: "User",
    avatarUrl: null,
    role: "owner",
  },
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => mocks.mockRouter,
    useRoute: () => ({
      query: mocks.routeQuery,
    }),
    RouterLink: { template: "<a><slot /></a>", props: ["to"] },
  };
});

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    loggedIn: mockRef(() => true),
    user: mockRef(() => mocks.user),
    fetchSession: vi.fn().mockResolvedValue(null),
    clearSession: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    uploadAvatar: vi.fn(),
  }),
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: (_url: string, _opts?: unknown) => ({
    data: mockRef(
      () => mocks.searchData,
      (v) => {
        mocks.searchData = v;
      },
    ),
    status: mockRef(() => mocks.status),
    error: mockRef(() => mocks.error),
    execute: mocks.execute,
  }),
}));

const stubs = {
  Card: {
    template: "<div><slot name='header' /><slot /><slot name='body' /></div>",
    props: ["variant", "ui"],
  },
  Badge: {
    template: "<span><slot>{{ label }}</slot></span>",
    props: ["label", "color", "variant", "size"],
  },
  Icon: { template: "<i :data-name='name' />", props: ["name", "class"] },
  Input: {
    template:
      "<input :value='modelValue' @input='$emit(\"update:modelValue\", $event.target.value)' />",
    props: ["modelValue"],
    emits: ["update:modelValue"],
  },
  Button: {
    template: "<button type='submit'>{{ label }}</button>",
    props: ["label", "type", "icon"],
  },
  RouterLink: { template: "<a><slot /></a>", props: ["to"] },
};

function makeResult(
  overrides: Partial<GlobalSearchResult> & { id: string; name: string },
): GlobalSearchResult {
  return {
    libraryId: "lib-1",
    libraryName: "My Library",
    parentFolderId: null,
    targetFolderId: null,
    kind: "file",
    locationPath: "/",
    mimeType: "text/plain",
    size: 100,
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("search.vue", () => {
  beforeEach(() => {
    mocks.searchData = { query: "", totalCount: 0, results: [] };
    mocks.status = "idle";
    mocks.error = null;
    mocks.execute.mockReset();
    mocks.mockRouter.push.mockReset();
    mocks.routeQuery = {};
  });

  function mountPage(query?: Record<string, string>) {
    if (query) {
      mocks.routeQuery = query;
    }
    return mount(SearchPage, { global: { stubs } });
  }

  it("renders search page with title", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Global Search");
  });

  it("shows minimum character message when query is short", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Enter at least 2 characters");
  });

  it("renders search form", () => {
    const wrapper = mountPage();
    expect(wrapper.find("input").exists()).toBe(true);
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("displays total match count when results exist", () => {
    mocks.searchData = {
      query: "test",
      totalCount: 42,
      results: [makeResult({ id: "f1", name: "test.txt" })],
    };
    mocks.status = "success";
    const wrapper = mountPage({ q: "test" });
    expect(wrapper.text()).toContain("42 total matches");
  });

  it("groups results by library", () => {
    mocks.searchData = {
      query: "doc",
      totalCount: 2,
      results: [
        makeResult({ id: "f1", name: "doc.txt", libraryId: "lib-1", libraryName: "Library A" }),
        makeResult({ id: "f2", name: "readme.md", libraryId: "lib-2", libraryName: "Library B" }),
      ],
    };
    mocks.status = "success";
    const wrapper = mountPage({ q: "doc" });

    expect(wrapper.text()).toContain("Library A");
    expect(wrapper.text()).toContain("Library B");
    expect(wrapper.text()).toContain("doc.txt");
    expect(wrapper.text()).toContain("readme.md");
  });
});
