import { mount } from "@vue/test-utils";
import IndexPage from "~/pages/index.vue";

const mocks = vi.hoisted(() => ({
  libraries: null as Array<{ id: string; name: string; isDefault: boolean }> | null,
  mockRouter: { replace: vi.fn(), push: vi.fn() },
}));

vi.mock("~/composables/useApiFetch", () => ({
  useApiFetch: () => ({
    data: {
      get value() {
        return mocks.libraries;
      },
    },
  }),
}));

vi.mock("#imports", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => mocks.mockRouter,
  };
});

describe("index.vue", () => {
  beforeEach(() => {
    mocks.libraries = null;
    mocks.mockRouter.replace.mockReset();
    mocks.mockRouter.push.mockReset();
  });

  it("renders empty div when no default library", () => {
    mocks.libraries = [{ id: "lib-1", name: "Not Default", isDefault: false }];
    const wrapper = mount(IndexPage);
    expect(wrapper.find("div").exists()).toBe(true);
  });

  it("renders when libraries is null", () => {
    mocks.libraries = null;
    const wrapper = mount(IndexPage);
    expect(wrapper.find("div").exists()).toBe(true);
  });
});
