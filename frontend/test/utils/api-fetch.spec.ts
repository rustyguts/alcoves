import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, ApiError } from "~/utils/api-fetch";

describe("apiFetch", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes a GET request by default", async () => {
    const mockData = { id: 1, name: "Test" };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockData),
    });

    const result = await apiFetch("/api/test");

    expect(global.fetch).toHaveBeenCalledWith("/api/test", {
      method: "GET",
      headers: {},
      credentials: "same-origin",
    });
    expect(result).toEqual(mockData);
  });

  it("makes a POST request with JSON body", async () => {
    const mockData = { success: true };
    const postData = { name: "New Item" };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockData),
    });

    const result = await apiFetch("/api/create", {
      method: "POST",
      body: postData,
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postData),
      credentials: "same-origin",
    });
    expect(result).toEqual(mockData);
  });

  it("handles FormData body without setting Content-Type", async () => {
    const formData = new FormData();
    formData.append("file", "test");

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ success: true }),
    });

    await apiFetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/upload", {
      method: "POST",
      headers: {},
      body: formData,
      credentials: "same-origin",
    });
  });

  it("appends query parameters to URL", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    await apiFetch("/api/search", {
      query: { q: "test", page: "2" },
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/search?q=test&page=2", expect.any(Object));
  });

  it("skips undefined query parameters", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    await apiFetch("/api/search", {
      query: { q: "test", page: undefined },
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/search?q=test", expect.any(Object));
  });

  it("appends query to existing query string", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    await apiFetch("/api/search?existing=param", {
      query: { q: "test" },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/search?existing=param&q=test",
      expect.any(Object),
    );
  });

  it("includes custom headers", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({}),
    });

    await apiFetch("/api/test", {
      headers: { "X-Custom": "value" },
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/test", {
      method: "GET",
      headers: { "X-Custom": "value" },
      credentials: "same-origin",
    });
  });

  it("returns blob when responseType is blob", async () => {
    const mockBlob = new Blob(["test"]);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      blob: async () => mockBlob,
    });

    const result = await apiFetch("/api/file", { responseType: "blob" });

    expect(result).toBe(mockBlob);
  });

  it("returns text when responseType is text", async () => {
    const mockText = "plain text response";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => mockText,
    });

    const result = await apiFetch("/api/text", { responseType: "text" });

    expect(result).toBe(mockText);
  });

  it("returns null for empty response body", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });

    const result = await apiFetch("/api/delete", { method: "DELETE" });

    expect(result).toBeNull();
  });

  it("throws ApiError on HTTP error with JSON response", async () => {
    const errorData = { message: "Not found", code: "NOT_FOUND" };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => errorData,
    });

    try {
      await apiFetch("/api/missing");
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).data).toEqual(errorData);
      expect((err as ApiError).message).toBe("Not found");
    }
  });

  it("throws ApiError on HTTP error with statusMessage", async () => {
    const errorData = { statusMessage: "Unauthorized access" };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => errorData,
    });

    try {
      await apiFetch("/api/protected");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe("Unauthorized access");
    }
  });

  it("throws ApiError on HTTP error without JSON response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("Not JSON");
      },
    });

    try {
      await apiFetch("/api/error");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).data).toBeNull();
      expect((err as ApiError).message).toBe("Request failed with status 500");
    }
  });
});

describe("ApiError", () => {
  it("creates error with message from data.message", () => {
    const error = new ApiError(400, { message: "Bad request" });

    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("Bad request");
    expect(error.status).toBe(400);
    expect(error.data).toEqual({ message: "Bad request" });
  });

  it("creates error with message from data.statusMessage", () => {
    const error = new ApiError(403, { statusMessage: "Forbidden" });

    expect(error.message).toBe("Forbidden");
    expect(error.status).toBe(403);
  });

  it("creates error with default message when no message in data", () => {
    const error = new ApiError(500, { code: "ERROR" });

    expect(error.message).toBe("Request failed with status 500");
  });

  it("creates error with default message when data is null", () => {
    const error = new ApiError(404, null);

    expect(error.message).toBe("Request failed with status 404");
    expect(error.data).toBeNull();
  });
});
