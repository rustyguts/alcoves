import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import SettingsPage from "~/pages/settings.vue";

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
}));

mockNuxtImport("navigateTo", () => mocks.navigateTo);

describe("settings.vue", () => {
  beforeEach(() => {
    mocks.navigateTo.mockReset();
  });

  async function mountPage() {
    return mountSuspended(SettingsPage);
  }

  it("redirects to /admin on mount", async () => {
    await mountPage();
    expect(mocks.navigateTo).toHaveBeenCalledWith("/admin", {
      replace: true,
      redirectCode: 301,
    });
  });
});
