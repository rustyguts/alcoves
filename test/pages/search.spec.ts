import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
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
  navigateTo: vi.fn(),
  user: { id: "user-1", email: "u@example.com", displayName: "User", avatarUrl: null, role: "owner" },
}));

mockNuxtImport("navigateTo", () => mocks.navigateTo);

mockNuxtImport("useUserSession", () => () => ({
  loggedIn: mockRef(() => true),
  user: mockRef(() => mocks.user),
  fetch: vi.fn().mockResolvedValue(null),
  clear: vi.fn(),
}));

mockNuxtImport("useFetch", () => (_url: string, _opts?: unknown) => ({
  data: mockRef(
    () => mocks.searchData,
    (v) => {
      mocks.searchData = v;
    },
  ),
  status: mockRef(() => mocks.status),
  error: mockRef(() => mocks.error),
  execute: mocks.execute,
}));

const stubs = {
  UCard: { template: "<div><slot name='header' /><slot /><slot name='body' /></div>", props: ["variant", "ui"] },
  UBadge: { template: "<span><slot>{{ label }}</slot></span>", props: ["label", "color", "variant", "size"] },
  UIcon: { template: "<i :data-name='name' />", props: ["name", "class"] },
  UInput: { template: "<input :value='modelValue' @input='$emit(\"update:modelValue\", $event.target.value)' />", props: ["modelValue"], emits: ["update:modelValue"] },
  UButton: { template: "<button type='submit'>{{ label }}</button>", props: ["label", "type", "icon"] },
  NuxtLink: { template: "<a><slot /></a>", props: ["to"] },
};

function makeResult(overrides: Partial<GlobalSearchResult> & { id: string; name: string }): GlobalSearchResult {
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
    mocks.navigateTo.mockReset();
  });

  async function mountPage(route = "/search") {
    return mountSuspended(SearchPage, { route, global: { stubs } });
  }

  it("renders search page with title", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Global Search");
  });

  it("shows minimum character message when query is short", async () => {
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("Enter at least 2 characters");
  });

  it("renders search form", async () => {
    const wrapper = await mountPage();
    expect(wrapper.find("input").exists()).toBe(true);
    expect(wrapper.find("button").exists()).toBe(true);
  });

  it("displays total match count when results exist", async () => {
    mocks.searchData = {
      query: "test",
      totalCount: 42,
      results: [makeResult({ id: "f1", name: "test.txt" })],
    };
    mocks.status = "success";
    const wrapper = await mountPage("/search?q=test");
    expect(wrapper.text()).toContain("42 total matches");
  });

  it("groups results by library", async () => {
    mocks.searchData = {
      query: "doc",
      totalCount: 2,
      results: [
        makeResult({ id: "f1", name: "doc.txt", libraryId: "lib-1", libraryName: "Library A" }),
        makeResult({ id: "f2", name: "readme.md", libraryId: "lib-2", libraryName: "Library B" }),
      ],
    };
    mocks.status = "success";
    const wrapper = await mountPage("/search?q=doc");

    expect(wrapper.text()).toContain("Library A");
    expect(wrapper.text()).toContain("Library B");
    expect(wrapper.text()).toContain("doc.txt");
    expect(wrapper.text()).toContain("readme.md");
  });
});
