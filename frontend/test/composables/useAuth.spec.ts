vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  router: {
    replace: vi.fn(),
    push: vi.fn(),
  },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => mocks.router,
}));

import { useAuth } from "~/composables/useAuth";
import { apiFetch } from "~/utils/api-fetch";

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

describe("useAuth", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mocks.router.replace.mockReset();
    mocks.router.push.mockReset();

    // Reset module-level auth state by clearing user
    const auth = useAuth();
    auth.clearSession();
  });

  it("login posts credentials then refreshes session", async () => {
    mockApiFetch
      .mockResolvedValueOnce({}) // login POST
      .mockResolvedValueOnce({ user: { id: "1", email: "a@b.com" } }); // fetchSession

    const auth = useAuth();
    await auth.login("a@b.com", "password123");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      body: { email: "a@b.com", password: "password123" },
    });
    expect(mockApiFetch).toHaveBeenCalledWith("/api/_auth/session");
  });

  it("register posts user data then refreshes session", async () => {
    mockApiFetch
      .mockResolvedValueOnce({}) // register POST
      .mockResolvedValueOnce({ user: { id: "1" } }); // fetchSession

    const auth = useAuth();
    await auth.register("Ada", "ada@example.com", "password123");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/auth/register", {
      method: "POST",
      body: { name: "Ada", email: "ada@example.com", password: "password123" },
    });
    expect(mockApiFetch).toHaveBeenCalledWith("/api/_auth/session");
  });

  it("logout clears session and navigates even if API call fails", async () => {
    // Set user first
    mockApiFetch.mockResolvedValueOnce({ user: { id: "1" } });
    const auth = useAuth();
    await auth.fetchSession();
    mockApiFetch.mockReset();

    mockApiFetch.mockRejectedValueOnce(new Error("boom"));

    await expect(auth.logout()).rejects.toThrow("boom");

    expect(mockApiFetch).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(mocks.router.replace).toHaveBeenCalledWith("/login");
  });

  it("updateProfile patches profile and refreshes session", async () => {
    const profile = {
      id: "user-1",
      email: "person@example.com",
      displayName: "Updated",
      avatarUrl: null,
      role: "owner",
    };
    mockApiFetch
      .mockResolvedValueOnce(profile) // PATCH
      .mockResolvedValueOnce({ user: profile }); // fetchSession

    const auth = useAuth();
    const result = await auth.updateProfile({ displayName: "Updated" });

    expect(result).toEqual(profile);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/auth/me", {
      method: "PATCH",
      body: { displayName: "Updated" },
    });
  });

  it("uploadAvatar sends multipart form data and refreshes session", async () => {
    const profile = {
      id: "user-1",
      email: "person@example.com",
      displayName: "Person",
      avatarUrl: "https://example.com/avatar.png",
      role: "owner",
    };
    mockApiFetch
      .mockResolvedValueOnce(profile) // POST avatar
      .mockResolvedValueOnce({ user: profile }); // fetchSession

    const auth = useAuth();
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    const result = await auth.uploadAvatar(file);

    expect(result).toEqual(profile);

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    const [url, options] = mockApiFetch.mock.calls[0] as [string, { method: string; body: FormData }];

    expect(url).toBe("/api/auth/me/avatar");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("avatar")).toBe(file);
  });
});
