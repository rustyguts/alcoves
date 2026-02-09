import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import IndexPage from "~/pages/index.vue";

const mocks = vi.hoisted(() => ({
  libraries: null as Array<{ id: string; name: string; isDefault: boolean }> | null,
  navigateTo: vi.fn(),
}));

mockNuxtImport("useFetch", () => () => ({
  data: {
    get value() {
      return mocks.libraries;
    },
  },
}));

mockNuxtImport("navigateTo", () => mocks.navigateTo);

describe("index.vue", () => {
  beforeEach(() => {
    mocks.libraries = null;
    mocks.navigateTo.mockReset();
  });

  it("renders empty div when no default library", async () => {
    mocks.libraries = [{ id: "lib-1", name: "Not Default", isDefault: false }];
    const wrapper = await mountSuspended(IndexPage);
    expect(wrapper.find("div").exists()).toBe(true);
  });

  it("renders when libraries is null", async () => {
    mocks.libraries = null;
    const wrapper = await mountSuspended(IndexPage);
    expect(wrapper.find("div").exists()).toBe(true);
  });
});
