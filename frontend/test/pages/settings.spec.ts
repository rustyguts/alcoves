import { mount } from "@vue/test-utils";
import SettingsPage from "~/pages/settings.vue";

const mocks = vi.hoisted(() => ({
  mockRouter: { replace: vi.fn(), push: vi.fn() },
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRouter: () => mocks.mockRouter,
  };
});

describe("settings.vue", () => {
  beforeEach(() => {
    mocks.mockRouter.replace.mockReset();
  });

  function mountPage() {
    return mount(SettingsPage);
  }

  it("redirects to /admin on mount", () => {
    mountPage();
    expect(mocks.mockRouter.replace).toHaveBeenCalledWith("/admin");
  });
});
