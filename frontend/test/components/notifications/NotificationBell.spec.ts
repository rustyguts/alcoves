import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

// Stub the composables before importing the component. We can't put `ref()`
// inside `vi.hoisted` because hoisted blocks run before module imports, so
// `vue` isn't available yet. Instead, declare placeholders inside hoisted
// and populate the refs inside `beforeAll` once the modules are loaded.
const mocks = vi.hoisted(() => ({
  notiState: {
    entries: { value: [] as unknown[] },
    unreadCount: { value: 0 },
    nextCursor: { value: null as string | null },
    loading: { value: false },
    loadingMore: { value: false },
    error: { value: null as string | null },
    loadFirst: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    refreshUnreadCount: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
    prependLive: vi.fn(),
  },
  socket: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribeRoom: vi.fn(),
    unsubscribeRoom: vi.fn(),
    onActivity: vi.fn().mockReturnValue(() => {}),
    connected: { value: true },
  },
}));

vi.mock("~/composables/useNotifications", () => ({
  useNotifications: () => mocks.notiState,
}));
vi.mock("~/composables/useNotificationsSocket", () => ({
  useNotificationsSocket: () => mocks.socket,
}));

// Replace plain objects with real refs so reactivity works inside the
// component under test.
beforeAll(() => {
  mocks.notiState.entries = ref<unknown[]>([]) as unknown as { value: unknown[] };
  mocks.notiState.unreadCount = ref(0) as unknown as { value: number };
  mocks.notiState.nextCursor = ref<string | null>(null) as unknown as { value: string | null };
  mocks.notiState.loading = ref(false) as unknown as { value: boolean };
  mocks.notiState.loadingMore = ref(false) as unknown as { value: boolean };
  mocks.notiState.error = ref<string | null>(null) as unknown as { value: string | null };
  mocks.socket.connected = ref(true) as unknown as { value: boolean };
});

import NotificationBell from "~/components/notifications/NotificationBell.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  UPopover: {
    template: "<div class='popover'><slot /></div>",
    props: ["open", "content"],
    emits: ["update:open"],
  },
  UButton: {
    template: "<button :aria-label=\"$attrs['aria-label']\"><slot /></button>",
    props: ["color", "variant", "square"],
  },
  NotificationDropdown: { template: "<div class='dropdown' />" },
};

describe("NotificationBell", () => {
  beforeEach(() => {
    mocks.notiState.unreadCount.value = 0;
    mocks.socket.connect.mockClear();
    mocks.socket.onActivity.mockClear();
    mocks.notiState.refreshUnreadCount.mockClear();
    mocks.notiState.prependLive.mockClear();
  });

  it("connects the websocket and registers an activity handler on mount", () => {
    mount(NotificationBell, { global: { stubs } });
    expect(mocks.socket.connect).toHaveBeenCalled();
    expect(mocks.socket.onActivity).toHaveBeenCalled();
    expect(mocks.notiState.refreshUnreadCount).toHaveBeenCalled();
  });

  it("hides the badge when unreadCount is 0", () => {
    mocks.notiState.unreadCount.value = 0;
    const wrapper = mount(NotificationBell, { global: { stubs } });
    expect(wrapper.html()).not.toContain(">0<");
  });

  it("renders the unread count when > 0", () => {
    mocks.notiState.unreadCount.value = 3;
    const wrapper = mount(NotificationBell, { global: { stubs } });
    expect(wrapper.text()).toContain("3");
  });

  it("caps the badge at 99+", () => {
    mocks.notiState.unreadCount.value = 250;
    const wrapper = mount(NotificationBell, { global: { stubs } });
    expect(wrapper.text()).toContain("99+");
  });

  it("forwards new activities into the global state via onActivity callback", () => {
    mount(NotificationBell, { global: { stubs } });
    const callback = mocks.socket.onActivity.mock.calls[0][0];
    const fake = {
      id: "abc",
      libraryId: "L",
      action: "file.created",
      actor: null,
      subjectType: "file",
      subjectId: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      dismissed: false,
    };
    callback(fake);
    expect(mocks.notiState.prependLive).toHaveBeenCalledWith(fake);
  });

  it("ignores activity callbacks with no id", () => {
    mount(NotificationBell, { global: { stubs } });
    const callback = mocks.socket.onActivity.mock.calls[0][0];
    callback({});
    expect(mocks.notiState.prependLive).not.toHaveBeenCalled();
  });
});
