import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

const mockApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

describe("useApiFetch", () => {
  it("returns the documented shape (data, error, status, refresh, execute)", () => {
    mockApiFetch.mockResolvedValue({ id: 1 });
    const result = useApiFetch("/api/test");
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("status");
    expect(typeof result.refresh).toBe("function");
    expect(typeof result.execute).toBe("function");
  });

  it("calls apiFetch with the resolved URL when executed", async () => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({ id: 1 });
    const { execute } = useApiFetch("/api/items", { immediate: false });
    await execute();
    expect(mockApiFetch).toHaveBeenCalled();
    const callArgs = mockApiFetch.mock.calls[0];
    expect(callArgs?.[0]).toBe("/api/items");
  });

  it("forwards a static query object to apiFetch", async () => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue({});
    const { execute } = useApiFetch("/api/search", {
      query: { q: "hello" },
      immediate: false,
    });
    await execute();
    const opts = mockApiFetch.mock.calls[0]?.[1] as { query?: Record<string, string> };
    expect(opts?.query).toEqual({ q: "hello" });
  });
});
