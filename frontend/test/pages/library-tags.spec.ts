import { mount } from "@vue/test-utils";
import TagsPage from "~/pages/libraries/[id]/tags.vue";

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

interface MockTag {
  id: string;
  name: string;
  color: string;
}

const mocks = vi.hoisted(() => ({
  routeId: "lib-1",
  toast: { add: vi.fn() },
  tags: [{ id: "t1", name: "Alpha", color: "#E11D48" }] as MockTag[],
  apiFetch: vi.fn(),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({
      params: { id: mocks.routeId },
      meta: {},
    }),
  };
});

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));
vi.mock("#imports", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRoute: () => ({
      params: { id: mocks.routeId },
      meta: {},
    }),
  };
});

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({
    data: mockRef(() => ({ id: mocks.routeId })),
  }),
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

describe("libraries/[id]/tags.vue", () => {
  beforeEach(() => {
    mocks.toast.add.mockReset();
    mocks.tags = [{ id: "t1", name: "Alpha", color: "#E11D48" }];
    mocks.apiFetch
      .mockReset()
      .mockImplementation((url: string, options?: Record<string, unknown>) => {
        if (url === "/api/libraries/lib-1/tags" && !options?.method) {
          return Promise.resolve([...mocks.tags]);
        }
        if (url === "/api/libraries/lib-1/files") {
          return Promise.resolve({
            entries: [
              { id: "f1", kind: "file", tags: [mocks.tags[0]] },
              { id: "f2", kind: "file", tags: [mocks.tags[0]] },
            ],
            nextCursor: null,
          });
        }
        if (url === "/api/libraries/lib-1/tags" && options?.method === "POST") {
          const body = options.body as { name?: string; color?: string };
          const created = {
            id: "t2",
            name: body.name ?? "New",
            color: body.color ?? "#3B82F6",
          };
          mocks.tags = [...mocks.tags, created];
          return Promise.resolve(created);
        }
        return Promise.resolve({});
      });
  });

  function mountPage() {
    return mount(TagsPage, {
      global: {
        provide: {
          refreshLibraries: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  }

  // Skipped: relies on a mocked `useRoute` providing `params.id`, but Nuxt's
  // auto-imported `useRoute` resolves from `#app/composables/router` and our
  // `vue-router`/`#imports` mocks don't intercept it. Tracked in
  // docs/todos.md item 9.
  it.skip("renders a flat tag manager", async () => {
    const wrapper = mountPage();

    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags");
    });

    expect(wrapper.text()).toContain("Tags");
    expect(wrapper.find("input[placeholder='Add a tag']").exists()).toBe(true);
    expect(wrapper.find("table").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Tag Manager");
  });

  // Skipped: relies on a mocked `useRoute` providing `params.id`, but Nuxt's
  // auto-imported `useRoute` resolves from `#app/composables/router` and our
  // `vue-router`/`#imports` mocks don't intercept it. Tracked in
  // docs/todos.md item 9.
  it.skip("creates a tag from the create row", async () => {
    const wrapper = mountPage();

    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags");
    });

    const createInput = wrapper.find("input[placeholder='Add a tag']");
    await createInput.setValue("New Tag");
    const createButton = wrapper
      .findAll("button")
      .find((b) => b.attributes("data-color") === "primary");
    await createButton?.trigger("click");

    await vi.waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/tags", {
        method: "POST",
        body: { name: "New Tag", color: "#E11D48" },
      });
    });
  });
});
