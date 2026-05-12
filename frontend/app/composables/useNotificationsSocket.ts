import type { Activity } from "~~/shared/types/api";

type ActivityHandler = (a: Activity) => void;

interface SocketState {
  ws: WebSocket | null;
  reconnectAttempt: number;
  closed: boolean;
  pollFallback: ReturnType<typeof setInterval> | null;
}

interface UseNotificationsSocketReturn {
  connect: () => void;
  disconnect: () => void;
  subscribeRoom: (room: string) => void;
  unsubscribeRoom: (room: string) => void;
  onActivity: (handler: ActivityHandler) => () => void;
  connected: Ref<boolean>;
}

const MAX_RECONNECT = 30_000;
const HEARTBEAT_TIMEOUT_MS = 35_000; // ping every 25s; close after 35s of silence

/**
 * Singleton-per-app WebSocket connection. Auto-joins the user's user:{id}
 * room; library: rooms subscribe/unsubscribe on demand from page mount.
 */
export function useNotificationsSocket(): UseNotificationsSocketReturn {
  const state = useState<SocketState>("notifications:socket-state", () => ({
    ws: null,
    reconnectAttempt: 0,
    closed: false,
    pollFallback: null,
  }));
  const connected = useState<boolean>("notifications:connected", () => false);
  const subscribedRooms = useState<Set<string>>("notifications:rooms", () => new Set());
  const handlers = useState<ActivityHandler[]>("notifications:handlers", () => []);
  let lastMessageAt = Date.now();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function wsUrl(): string {
    if (!import.meta.client) return "";
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Same-origin: Nuxt's nitro proxy rewrites /api/** to the Go API in dev.
    return `${proto}//${window.location.host}/api/ws`;
  }

  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (!state.value.ws) return;
      if (Date.now() - lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
        // Force-close; onclose triggers reconnect.
        try {
          state.value.ws.close();
        } catch {}
      }
    }, 10_000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect() {
    if (state.value.closed) return;
    const attempt = state.value.reconnectAttempt + 1;
    state.value.reconnectAttempt = attempt;
    const base = Math.min(MAX_RECONNECT, 1000 * Math.pow(2, attempt - 1));
    const delay = base * (0.75 + Math.random() * 0.5); // jitter
    // After 3 failures, start polling unread-count as a fallback.
    if (attempt >= 3 && !state.value.pollFallback) {
      state.value.pollFallback = setInterval(() => {
        useNotifications().refreshUnreadCount();
      }, 60_000);
    }
    setTimeout(connect, delay);
  }

  function stopPollFallback() {
    if (state.value.pollFallback) {
      clearInterval(state.value.pollFallback);
      state.value.pollFallback = null;
    }
  }

  function connect() {
    if (!import.meta.client) return;
    if (state.value.ws && state.value.ws.readyState === WebSocket.OPEN) return;
    state.value.closed = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    state.value.ws = ws;
    ws.addEventListener("open", () => {
      connected.value = true;
      state.value.reconnectAttempt = 0;
      lastMessageAt = Date.now();
      // Re-subscribe to all known library rooms.
      for (const room of subscribedRooms.value) {
        ws.send(JSON.stringify({ type: "subscribe", room }));
      }
      // On reconnect, recover any events dropped during the gap by
      // refetching the bell unread count.
      useNotifications().refreshUnreadCount().catch(() => {});
      stopPollFallback();
      startHeartbeat();
    });
    ws.addEventListener("message", (ev) => {
      lastMessageAt = Date.now();
      try {
        const data = JSON.parse(ev.data as string);
        if (data?.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (data?.type === "subscribed" || data?.type === "unsubscribed" || data?.type === "error") {
          return;
        }
        // Otherwise it's an activity payload (no `type` field).
        const activity = data as Activity;
        for (const h of handlers.value) h(activity);
      } catch {
        // ignore malformed frame
      }
    });
    ws.addEventListener("close", () => {
      connected.value = false;
      stopHeartbeat();
      state.value.ws = null;
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {}
    });
  }

  function disconnect() {
    state.value.closed = true;
    stopHeartbeat();
    stopPollFallback();
    if (state.value.ws) {
      try {
        state.value.ws.close();
      } catch {}
    }
    state.value.ws = null;
    connected.value = false;
  }

  function subscribeRoom(room: string) {
    subscribedRooms.value.add(room);
    if (state.value.ws && state.value.ws.readyState === WebSocket.OPEN) {
      state.value.ws.send(JSON.stringify({ type: "subscribe", room }));
    }
  }

  function unsubscribeRoom(room: string) {
    subscribedRooms.value.delete(room);
    if (state.value.ws && state.value.ws.readyState === WebSocket.OPEN) {
      state.value.ws.send(JSON.stringify({ type: "unsubscribe", room }));
    }
  }

  function onActivity(handler: ActivityHandler): () => void {
    handlers.value.push(handler);
    return () => {
      const i = handlers.value.indexOf(handler);
      if (i >= 0) handlers.value.splice(i, 1);
    };
  }

  return { connect, disconnect, subscribeRoom, unsubscribeRoom, onActivity, connected };
}
