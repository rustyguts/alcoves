import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";

vi.mock("~/utils/api-fetch");

describe("useApiFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes immediately by default", async () => {
    const mockData = { id: 1, name: "Test" };
    vi.mocked(apiFetch).mockResolvedValueOnce(mockData);

    const { data, error, status } = useApiFetch("/api/test");

    expect(status.value).toBe("pending");

    await nextTick();
    await vi.waitFor(() => {
      expect(status.value).toBe("success");
    });

    expect(data.value).toEqual(mockData);
    expect(error.value).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/api/test", {});
  });

  it("does not execute immediately when immediate is false", async () => {
    const mockData = { id: 1 };
    vi.mocked(apiFetch).mockResolvedValueOnce(mockData);

    const { data, status, execute } = useApiFetch("/api/test", { immediate: false });

    expect(status.value).toBe("idle");
    expect(data.value).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();

    await execute();

    expect(status.value).toBe("success");
    expect(data.value).toEqual(mockData);
  });

  it("uses default value when provided", () => {
    const defaultValue = { id: 0, name: "Default" };
    const { data, status } = useApiFetch("/api/test", {
      immediate: false,
      default: () => defaultValue,
    });

    expect(status.value).toBe("idle");
    expect(data.value).toEqual(defaultValue);
  });

  it("handles errors", async () => {
    const mockError = new Error("API Error");
    vi.mocked(apiFetch).mockRejectedValueOnce(mockError);

    const { data, error, status } = useApiFetch("/api/test");

    await vi.waitFor(() => {
      expect(status.value).toBe("error");
    });

    expect(data.value).toBeNull();
    expect(error.value).toBe(mockError);
  });

  it("passes fetch options to apiFetch", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({});

    useApiFetch("/api/test", {
      method: "POST",
      body: { test: true },
      headers: { "X-Custom": "header" },
    });

    await vi.waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/test", {
        method: "POST",
        body: { test: true },
        headers: { "X-Custom": "header" },
      });
    });
  });

  it("passes static query parameters", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({});

    useApiFetch("/api/search", {
      query: { q: "test", page: "1" },
    });

    await vi.waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/search", {
        query: { q: "test", page: "1" },
      });
    });
  });

  it("resolves reactive query parameters", async () => {
    const query = ref({ q: "test" });
    vi.mocked(apiFetch).mockResolvedValueOnce({});

    useApiFetch("/api/search", { query });

    await vi.waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/search", {
        query: { q: "test" },
      });
    });
  });

  it("resolves getter query parameters", async () => {
    const queryGetter = () => ({ q: "test" });
    vi.mocked(apiFetch).mockResolvedValueOnce({});

    useApiFetch("/api/search", { query: queryGetter });

    await vi.waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/api/search", {
        query: { q: "test" },
      });
    });
  });

  it("refreshes data when calling refresh", async () => {
    const mockData1 = { id: 1 };
    const mockData2 = { id: 2 };
    vi.mocked(apiFetch).mockResolvedValueOnce(mockData1).mockResolvedValueOnce(mockData2);

    const { data, refresh } = useApiFetch("/api/test");

    await vi.waitFor(() => {
      expect(data.value).toEqual(mockData1);
    });

    await refresh();

    expect(data.value).toEqual(mockData2);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("watches reactive URL and refetches on change", async () => {
    const url = ref("/api/test1");
    const mockData1 = { id: 1 };
    const mockData2 = { id: 2 };

    vi.mocked(apiFetch).mockResolvedValueOnce(mockData1).mockResolvedValueOnce(mockData2);

    const { data } = useApiFetch(url);

    await vi.waitFor(() => {
      expect(data.value).toEqual(mockData1);
    });

    url.value = "/api/test2";

    await vi.waitFor(() => {
      expect(data.value).toEqual(mockData2);
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/test1", {});
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/test2", {});
  });

  it("watches URL getter and refetches on dependency change", async () => {
    const id = ref(1);
    const urlGetter = () => `/api/item/${id.value}`;

    const mockData1 = { id: 1 };
    const mockData2 = { id: 2 };

    vi.mocked(apiFetch).mockResolvedValueOnce(mockData1).mockResolvedValueOnce(mockData2);

    const { data } = useApiFetch(urlGetter);

    await vi.waitFor(() => {
      expect(data.value).toEqual(mockData1);
    });

    id.value = 2;

    await vi.waitFor(() => {
      expect(data.value).toEqual(mockData2);
    });

    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/item/1", {});
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/item/2", {});
  });

  it("clears error on successful refetch", async () => {
    const mockError = new Error("Error");
    const mockData = { id: 1 };

    vi.mocked(apiFetch).mockRejectedValueOnce(mockError).mockResolvedValueOnce(mockData);

    const { data, error, status, refresh } = useApiFetch("/api/test");

    await vi.waitFor(() => {
      expect(status.value).toBe("error");
    });

    expect(error.value).toBe(mockError);

    await refresh();

    expect(status.value).toBe("success");
    expect(data.value).toEqual(mockData);
    expect(error.value).toBeNull();
  });

  it("sets status to pending during request", async () => {
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    vi.mocked(apiFetch).mockReturnValueOnce(promise as Promise<unknown>);

    const { status } = useApiFetch("/api/test");

    await nextTick();

    expect(status.value).toBe("pending");

    resolvePromise!({ id: 1 });
    await vi.waitFor(() => {
      expect(status.value).toBe("success");
    });
  });
});
