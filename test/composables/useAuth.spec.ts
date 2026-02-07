import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useAuth } from "~/composables/useAuth";

const mocks = vi.hoisted(() => ({
  user: {
    id: "user-1",
    email: "person@example.com",
    displayName: "Person",
    avatarUrl: null as string | null,
    role: "owner",
  },
  loggedIn: false,
  fetchSession: vi.fn(),
  clear: vi.fn(),
  navigateTo: vi.fn(),
  fetch: vi.fn(),
}));

mockNuxtImport("useUserSession", () => {
  return () => ({
    user: {
      get value() {
        return mocks.user;
      },
      set value(value: typeof mocks.user) {
        mocks.user = value;
      },
    },
    loggedIn: {
      get value() {
        return mocks.loggedIn;
      },
      set value(value: boolean) {
        mocks.loggedIn = value;
      },
    },
    fetch: mocks.fetchSession,
    clear: mocks.clear,
  });
});

mockNuxtImport("navigateTo", () => mocks.navigateTo);

describe("useAuth", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.fetchSession.mockReset();
    mocks.clear.mockReset();
    mocks.navigateTo.mockReset();

    vi.stubGlobal("$fetch", mocks.fetch);
  });

  it("login posts credentials then refreshes session", async () => {
    mocks.fetch.mockResolvedValueOnce({});

    const auth = useAuth();
    await auth.login("a@b.com", "password123");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      body: { email: "a@b.com", password: "password123" },
    });
    expect(mocks.fetchSession).toHaveBeenCalledTimes(1);
  });

  it("register posts user data then refreshes session", async () => {
    mocks.fetch.mockResolvedValueOnce({});

    const auth = useAuth();
    await auth.register("Ada", "ada@example.com", "password123");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/register", {
      method: "POST",
      body: { name: "Ada", email: "ada@example.com", password: "password123" },
    });
    expect(mocks.fetchSession).toHaveBeenCalledTimes(1);
  });

  it("logout clears local session and navigates even if API call fails", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("boom"));

    const auth = useAuth();
    await expect(auth.logout()).rejects.toThrow("boom");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.navigateTo).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("updateProfile patches profile and refreshes session", async () => {
    const profile = {
      id: "user-1",
      email: "person@example.com",
      displayName: "Updated",
      avatarUrl: null,
      role: "owner",
    };
    mocks.fetch.mockResolvedValueOnce(profile);

    const auth = useAuth();
    const result = await auth.updateProfile({ displayName: "Updated" });

    expect(result).toEqual(profile);
    expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/me", {
      method: "PATCH",
      body: { displayName: "Updated" },
    });
    expect(mocks.fetchSession).toHaveBeenCalledTimes(1);
  });

  it("uploadAvatar sends multipart form data and refreshes session", async () => {
    const profile = {
      id: "user-1",
      email: "person@example.com",
      displayName: "Person",
      avatarUrl: "https://example.com/avatar.png",
      role: "owner",
    };
    mocks.fetch.mockResolvedValueOnce(profile);

    const auth = useAuth();
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    const result = await auth.uploadAvatar(file);

    expect(result).toEqual(profile);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [, options] = mocks.fetch.mock.calls[0] as [string, { method: string; body: FormData }];

    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("avatar")).toBe(file);
    expect(mocks.fetchSession).toHaveBeenCalledTimes(1);
  });
});
