import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => mocks.router,
}));
vi.mock("#imports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => mocks.router,
}));

import { useAuth } from "~/composables/useAuth";
import { apiFetch } from "~/utils/api-fetch";

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockApiFetch.mockReset();
  mocks.router.replace.mockReset();
  useAuth().clearSession();
});

describe("useAuth branches", () => {
  it("register posts the payload then refreshes the session", async () => {
    mockApiFetch
      .mockResolvedValueOnce(undefined) // register POST
      .mockResolvedValueOnce({ user: { id: "1", email: "a@b.com" } }); // fetchSession
    const auth = useAuth();
    await auth.register("Al", "a@b.com", "pw", "invite-1");
    expect(mockApiFetch.mock.calls[0]![0]).toBe("/api/auth/register");
    expect(auth.loggedIn.value).toBe(true);
  });

  it("logout calls the API and clears the session", async () => {
    mockApiFetch.mockResolvedValueOnce(undefined); // logout POST
    const auth = useAuth();
    await auth.logout();
    expect(mockApiFetch.mock.calls[0]![0]).toBe("/api/auth/logout");
    expect(auth.loggedIn.value).toBe(false);
  });

  it("updateProfile patches the user then refreshes and returns the data", async () => {
    const updated = { id: "1", email: "a@b.com", displayName: "New" };
    mockApiFetch
      .mockResolvedValueOnce(updated) // updateMe PATCH
      .mockResolvedValueOnce({ user: updated }); // fetchSession
    const auth = useAuth();
    const result = await auth.updateProfile({ displayName: "New" });
    expect(mockApiFetch.mock.calls[0]![0]).toBe("/api/auth/me");
    expect(result).toEqual(updated);
  });

  it("uploadAvatar sends a FormData payload then refreshes", async () => {
    const updated = { id: "1", email: "a@b.com", avatarUrl: "/a.png" };
    mockApiFetch
      .mockResolvedValueOnce(updated) // uploadAvatar POST
      .mockResolvedValueOnce({ user: updated }); // fetchSession
    const auth = useAuth();
    const file = new File(["x"], "a.png", { type: "image/png" });
    const result = await auth.uploadAvatar(file);
    expect(mockApiFetch.mock.calls[0]![0]).toBe("/api/auth/me/avatar");
    const body = mockApiFetch.mock.calls[0]![1]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(result).toEqual(updated);
  });
});
