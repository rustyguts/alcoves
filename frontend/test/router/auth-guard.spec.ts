import { setupAuthGuard } from "~/router/auth-guard";

const mocks = vi.hoisted(() => ({
  loggedIn: false,
  user: null as { role: string } | null,
  fetchSession: vi.fn(),
}));

vi.mock("~/composables/useAuth", () => ({
  useAuth: () => ({
    loggedIn: {
      get value() {
        return mocks.loggedIn;
      },
    },
    user: {
      get value() {
        return mocks.user;
      },
    },
    fetchSession: mocks.fetchSession,
  }),
}));

describe("auth guard", () => {
  let guard: (to: { path: string; fullPath: string }) => Promise<unknown>;

  beforeEach(() => {
    mocks.loggedIn = false;
    mocks.user = null;
    mocks.fetchSession.mockReset();

    // Extract the beforeEach guard callback
    const fakeRouter = {
      beforeEach: vi.fn(),
    };
    setupAuthGuard(fakeRouter as never);
    guard = fakeRouter.beforeEach.mock.calls[0][0];
  });

  it("allows public routes without session checks", async () => {
    const result = await guard({ path: "/login", fullPath: "/login" });

    expect(result).toBeUndefined();
    expect(mocks.fetchSession).not.toHaveBeenCalled();
  });

  it("allows /register as a public route", async () => {
    const result = await guard({ path: "/register", fullPath: "/register" });

    expect(result).toBeUndefined();
    expect(mocks.fetchSession).not.toHaveBeenCalled();
  });

  it("calls fetchSession when user is not logged in", async () => {
    mocks.fetchSession.mockImplementation(() => {
      // Simulate that fetchSession updates the state
      mocks.loggedIn = true;
      mocks.user = { role: "viewer" };
    });

    const result = await guard({ path: "/", fullPath: "/" });

    expect(mocks.fetchSession).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("redirects unauthenticated users to login with redirect query", async () => {
    // fetchSession does not set loggedIn to true
    mocks.fetchSession.mockResolvedValue(undefined);

    const result = await guard({ path: "/search", fullPath: "/search?q=docs" });

    expect(mocks.fetchSession).toHaveBeenCalled();
    expect(result).toEqual({
      path: "/login",
      query: { redirect: "/search?q=docs" },
    });
  });

  it("redirects non-owner users away from owner-only routes", async () => {
    mocks.loggedIn = true;
    mocks.user = { role: "viewer" };

    const result = await guard({ path: "/settings", fullPath: "/settings" });

    expect(result).toBe("/");
  });

  it("redirects non-owner users away from admin routes", async () => {
    mocks.loggedIn = true;
    mocks.user = { role: "viewer" };

    const result = await guard({ path: "/admin", fullPath: "/admin" });

    expect(result).toBe("/");
  });

  it("allows owners on owner-only routes", async () => {
    mocks.loggedIn = true;
    mocks.user = { role: "owner" };

    const result = await guard({ path: "/settings", fullPath: "/settings" });

    expect(result).toBeUndefined();
  });

  it("skips fetchSession if already logged in", async () => {
    mocks.loggedIn = true;
    mocks.user = { role: "viewer" };

    await guard({ path: "/", fullPath: "/" });

    expect(mocks.fetchSession).not.toHaveBeenCalled();
  });
});
