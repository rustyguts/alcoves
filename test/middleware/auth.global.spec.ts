import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import authMiddleware from "~/middleware/auth.global";

const mocks = vi.hoisted(() => ({
  loggedIn: false,
  user: null as { role?: string } | null,
  fetchSession: vi.fn(),
  navigateTo: vi.fn(),
}));

mockNuxtImport("useUserSession", () => {
  return () => ({
    loggedIn: {
      get value() {
        return mocks.loggedIn;
      },
      set value(value: boolean) {
        mocks.loggedIn = value;
      },
    },
    user: {
      get value() {
        return mocks.user;
      },
      set value(value: { role?: string } | null) {
        mocks.user = value;
      },
    },
    fetch: mocks.fetchSession,
  });
});

mockNuxtImport("navigateTo", () => mocks.navigateTo);

describe("auth.global middleware", () => {
  beforeEach(() => {
    mocks.loggedIn = false;
    mocks.user = null;
    mocks.fetchSession.mockReset();
    mocks.navigateTo.mockReset();
  });

  it("allows public routes without session checks", async () => {
    const to = { path: "/login", fullPath: "/login" };

    const result = await authMiddleware(to as never);

    expect(result).toBeUndefined();
    expect(mocks.fetchSession).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated users to login with redirect query", async () => {
    const redirectTarget = { path: "/login", query: { redirect: "/search?q=docs" } };
    mocks.navigateTo.mockResolvedValue(redirectTarget);

    const to = { path: "/search", fullPath: "/search?q=docs" };
    const result = await authMiddleware(to as never);

    expect(mocks.fetchSession).toHaveBeenCalledTimes(1);
    expect(mocks.navigateTo).toHaveBeenCalledWith({
      path: "/login",
      query: { redirect: "/search?q=docs" },
    });
    expect(result).toEqual(redirectTarget);
  });

  it("redirects non-owner users away from owner-only routes", async () => {
    mocks.loggedIn = true;
    mocks.user = { role: "viewer" };

    await authMiddleware({ path: "/settings", fullPath: "/settings" } as never);

    expect(mocks.navigateTo).toHaveBeenCalledWith("/");
  });

  it("allows owners on owner-only routes", async () => {
    mocks.loggedIn = true;
    mocks.user = { role: "owner" };

    const result = await authMiddleware({ path: "/settings", fullPath: "/settings" } as never);

    expect(result).toBeUndefined();
    expect(mocks.navigateTo).not.toHaveBeenCalled();
  });
});
