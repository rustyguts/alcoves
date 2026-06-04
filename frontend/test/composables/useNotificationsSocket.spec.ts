import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const refreshUnreadCount = vi.fn(() => Promise.resolve());
vi.mock("~/composables/useNotifications", () => ({
  useNotifications: () => ({ refreshUnreadCount }),
}));

import { useNotificationsSocket } from "~/composables/useNotificationsSocket";
import type { Activity } from "~~/shared/types/api";

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    return FakeWebSocket.instances.at(-1)!;
  }
  url: string;
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, Array<(ev?: unknown) => void>> = {};
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev?: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
  emit(type: string, ev?: unknown) {
    (this.listeners[type] ?? []).forEach((cb) => cb(ev));
  }
  doOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }
  doMessage(data: unknown) {
    this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}

function resetState() {
  // useState is a Nuxt auto-import; reset the singleton between tests.
  useState("notifications:handlers", () => []).value = [];
  useState("notifications:rooms", () => new Set()).value = new Set();
  useState("notifications:socket-state", () => ({})).value = {
    ws: null,
    reconnectAttempt: 0,
    closed: false,
    pollFallback: null,
  };
  useState("notifications:connected", () => false).value = false;
}

const activity = (id: string): Activity =>
  ({
    id,
    libraryId: "lib1",
    actor: { id: "u", displayName: "A", avatarUrl: null },
    action: "file.created",
    subjectType: "file",
    subjectId: "f",
    metadata: {},
    createdAt: "",
    dismissed: false,
  }) as Activity;

beforeEach(() => {
  vi.useFakeTimers();
  refreshUnreadCount.mockClear();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  resetState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNotificationsSocket", () => {
  it("connects, marks connected on open, and refreshes the unread count", () => {
    const sock = useNotificationsSocket();
    sock.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last().url).toContain("/api/ws");

    FakeWebSocket.last().doOpen();
    expect(sock.connected.value).toBe(true);
    expect(refreshUnreadCount).toHaveBeenCalled();
  });

  it("re-subscribes known rooms on open", () => {
    const sock = useNotificationsSocket();
    sock.subscribeRoom("library:1");
    sock.connect();
    FakeWebSocket.last().doOpen();
    expect(FakeWebSocket.last().sent).toContainEqual(
      JSON.stringify({ type: "subscribe", room: "library:1" }),
    );
  });

  it("dispatches activity payloads to registered handlers", () => {
    const sock = useNotificationsSocket();
    const handler = vi.fn();
    sock.onActivity(handler);
    sock.connect();
    FakeWebSocket.last().doOpen();
    FakeWebSocket.last().doMessage(activity("a1"));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
  });

  it("responds to ping frames with a pong", () => {
    const sock = useNotificationsSocket();
    sock.connect();
    FakeWebSocket.last().doOpen();
    FakeWebSocket.last().sent.length = 0;
    FakeWebSocket.last().doMessage({ type: "ping" });
    expect(FakeWebSocket.last().sent).toContainEqual(JSON.stringify({ type: "pong" }));
  });

  it("ignores control frames and malformed messages", () => {
    const sock = useNotificationsSocket();
    const handler = vi.fn();
    sock.onActivity(handler);
    sock.connect();
    FakeWebSocket.last().doOpen();
    FakeWebSocket.last().doMessage({ type: "subscribed" });
    FakeWebSocket.last().doMessage({ type: "error" });
    FakeWebSocket.last().emit("message", { data: "not json{" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("onActivity returns an unsubscribe function", () => {
    const sock = useNotificationsSocket();
    const handler = vi.fn();
    const off = sock.onActivity(handler);
    off();
    sock.connect();
    FakeWebSocket.last().doOpen();
    FakeWebSocket.last().doMessage(activity("a1"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("subscribeRoom/unsubscribeRoom send frames when the socket is open", () => {
    const sock = useNotificationsSocket();
    sock.connect();
    FakeWebSocket.last().doOpen();
    FakeWebSocket.last().sent.length = 0;
    sock.subscribeRoom("library:7");
    sock.unsubscribeRoom("library:7");
    expect(FakeWebSocket.last().sent).toEqual([
      JSON.stringify({ type: "subscribe", room: "library:7" }),
      JSON.stringify({ type: "unsubscribe", room: "library:7" }),
    ]);
  });

  it("schedules a reconnect after the socket closes", () => {
    const sock = useNotificationsSocket();
    sock.connect();
    FakeWebSocket.last().doOpen();
    FakeWebSocket.last().close();
    expect(sock.connected.value).toBe(false);
    // reconnect timer fires → new socket created
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it("does not reconnect after an explicit disconnect", () => {
    const sock = useNotificationsSocket();
    sock.connect();
    FakeWebSocket.last().doOpen();
    sock.disconnect();
    expect(sock.connected.value).toBe(false);
    const count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(count);
  });

  it("starts a polling fallback after repeated reconnect failures", () => {
    const sock = useNotificationsSocket();
    sock.connect();
    // simulate 3 failed cycles: open then close repeatedly
    for (let i = 0; i < 3; i++) {
      FakeWebSocket.last().close();
      vi.advanceTimersByTime(30_000);
    }
    refreshUnreadCount.mockClear();
    vi.advanceTimersByTime(60_000);
    expect(refreshUnreadCount).toHaveBeenCalled();
  });

  it("skips reconnecting an already-open socket", () => {
    const sock = useNotificationsSocket();
    sock.connect();
    FakeWebSocket.last().doOpen();
    sock.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
