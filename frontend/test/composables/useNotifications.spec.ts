vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

import { useNotifications } from "~/composables/useNotifications";
import { apiFetch } from "~/utils/api-fetch";
import type { Activity, NotificationsResponse } from "~~/shared/types/api";

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
  // Reset Nuxt's useState across tests by recreating composable.
  const n = useNotifications();
  n.entries.value = [];
  n.unreadCount.value = 0;
  n.nextCursor.value = null;
});

describe("useNotifications", () => {
  it("loadFirst populates entries, cursor, and unreadCount", async () => {
    mockApiFetch.mockResolvedValueOnce({
      entries: [makeActivity("a1"), makeActivity("a2")],
      nextCursor: "cursor-1",
      unreadCount: 2,
    } satisfies NotificationsResponse);

    const n = useNotifications();
    await n.loadFirst();

    expect(n.entries.value).toHaveLength(2);
    expect(n.nextCursor.value).toBe("cursor-1");
    expect(n.unreadCount.value).toBe(2);
  });

  it("loadMore appends entries and bumps the cursor", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ entries: [makeActivity("a1")], nextCursor: "c1", unreadCount: 1 })
      .mockResolvedValueOnce({ entries: [makeActivity("a2")], nextCursor: null, unreadCount: 1 });

    const n = useNotifications();
    await n.loadFirst();
    await n.loadMore();
    expect(n.entries.value.map((e) => e.id)).toEqual(["a1", "a2"]);
    expect(n.nextCursor.value).toBeNull();
  });

  it("loadMore is a no-op without a nextCursor", async () => {
    mockApiFetch.mockResolvedValueOnce({ entries: [makeActivity("a1")], nextCursor: null, unreadCount: 1 });
    const n = useNotifications();
    await n.loadFirst();
    mockApiFetch.mockClear();
    await n.loadMore();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("dismiss removes the row optimistically and decrements unread", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ entries: [makeActivity("a1"), makeActivity("a2")], nextCursor: null, unreadCount: 2 })
      .mockResolvedValueOnce(undefined);
    const n = useNotifications();
    await n.loadFirst();
    await n.dismiss("a1");

    expect(n.entries.value.map((e) => e.id)).toEqual(["a2"]);
    expect(n.unreadCount.value).toBe(1);
    expect(mockApiFetch).toHaveBeenLastCalledWith("/api/notifications/a1/dismiss", { method: "POST" });
  });

  it("dismissAll clears entries and resets unreadCount to 0", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ entries: [makeActivity("a1"), makeActivity("a2")], nextCursor: null, unreadCount: 2 })
      .mockResolvedValueOnce(undefined);
    const n = useNotifications();
    await n.loadFirst();
    await n.dismissAll();

    expect(n.entries.value).toHaveLength(0);
    expect(n.unreadCount.value).toBe(0);
    expect(mockApiFetch).toHaveBeenLastCalledWith("/api/notifications/dismiss-all", { method: "POST" });
  });

  it("refreshUnreadCount updates only the badge", async () => {
    mockApiFetch.mockResolvedValueOnce({ unreadCount: 7 });
    const n = useNotifications();
    await n.refreshUnreadCount();
    expect(n.unreadCount.value).toBe(7);
  });

  it("prependLive adds a fresh activity and bumps unread", async () => {
    const n = useNotifications();
    n.prependLive(makeActivity("new-1"));
    expect(n.entries.value[0].id).toBe("new-1");
    expect(n.unreadCount.value).toBe(1);
  });

  it("prependLive dedupes by id", async () => {
    const n = useNotifications();
    n.prependLive(makeActivity("dup"));
    n.prependLive(makeActivity("dup"));
    expect(n.entries.value.length).toBe(1);
    expect(n.unreadCount.value).toBe(1); // only the first push bumped it
  });
});
