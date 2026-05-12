vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

import { useLibraryFeed } from "~/composables/useLibraryFeed";
import { apiFetch } from "~/utils/api-fetch";
import type { Activity, LibraryFeedResponse } from "~~/shared/types/api";

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

function makeActivity(id: string): Activity {
  return {
    id,
    libraryId: "lib-1",
    libraryName: "L",
    actor: { id: "u1", displayName: "Alice", avatarUrl: null },
    action: "file.created",
    subjectType: "file",
    subjectId: "f1",
    metadata: { name: id },
    createdAt: new Date().toISOString(),
    dismissed: false,
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe("useLibraryFeed", () => {
  it("loadFirst fetches and populates entries", async () => {
    mockApiFetch.mockResolvedValueOnce({
      entries: [makeActivity("1"), makeActivity("2")],
      nextCursor: "c1",
    } satisfies LibraryFeedResponse);

    const feed = useLibraryFeed("lib-1");
    await feed.loadFirst();

    expect(feed.entries.value).toHaveLength(2);
    expect(feed.nextCursor.value).toBe("c1");
    expect(mockApiFetch).toHaveBeenCalledWith("/api/libraries/lib-1/feed", { query: {} });
  });

  it("loadMore passes the cursor query param", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ entries: [makeActivity("1")], nextCursor: "c1" })
      .mockResolvedValueOnce({ entries: [makeActivity("2")], nextCursor: null });

    const feed = useLibraryFeed("lib-1");
    await feed.loadFirst();
    await feed.loadMore();

    expect(mockApiFetch).toHaveBeenLastCalledWith("/api/libraries/lib-1/feed", { query: { cursor: "c1" } });
    expect(feed.entries.value.map((e) => e.id)).toEqual(["1", "2"]);
    expect(feed.nextCursor.value).toBeNull();
  });

  it("prependLive dedupes by id", async () => {
    mockApiFetch.mockResolvedValueOnce({ entries: [], nextCursor: null });
    const feed = useLibraryFeed("lib-1");
    await feed.loadFirst();
    feed.prependLive(makeActivity("x"));
    feed.prependLive(makeActivity("x"));
    expect(feed.entries.value.length).toBe(1);
  });

  it("captures error message on failed load", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("boom"));
    const feed = useLibraryFeed("lib-1");
    await feed.loadFirst();
    expect(feed.error.value).toBe("boom");
    expect(feed.entries.value).toHaveLength(0);
  });
});
