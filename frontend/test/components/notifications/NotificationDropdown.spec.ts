import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, nextTick } from "vue";
import type { Activity } from "~~/shared/types/api";

const loadFirst = vi.fn();
const dismiss = vi.fn();
const dismissAll = vi.fn(() => Promise.resolve());
const entries = ref<Activity[]>([]);
const loading = ref(false);
const nextCursor = ref<string | null>(null);

vi.mock("~/composables/useNotifications", () => ({
  useNotifications: () => ({ entries, loading, nextCursor, loadFirst, dismiss, dismissAll }),
}));

import NotificationDropdown from "~/components/notifications/NotificationDropdown.vue";

function makeActivity(id: string): Activity {
  return {
    id,
    libraryId: "lib1",
    actor: { id: "u", displayName: "Alice", avatarUrl: null },
    action: "file.created",
    subjectType: "file",
    subjectId: "f",
    metadata: { name: id },
    createdAt: "2026-01-01T00:00:00Z",
    dismissed: false,
  } as Activity;
}

function mountDropdown() {
  return mount(NotificationDropdown, { global: { stubs: { NotificationItem: true } } });
}

beforeEach(() => {
  loadFirst.mockClear();
  dismiss.mockClear();
  dismissAll.mockClear();
  entries.value = [];
  loading.value = false;
  nextCursor.value = null;
});

describe("NotificationDropdown", () => {
  it("loads the first page on mount when empty", () => {
    mountDropdown();
    expect(loadFirst).toHaveBeenCalledTimes(1);
  });

  it("does not load when entries already exist", () => {
    entries.value = [makeActivity("a1")];
    mountDropdown();
    expect(loadFirst).not.toHaveBeenCalled();
  });

  it("shows the loading state on first load", () => {
    loading.value = true;
    const wrapper = mountDropdown();
    expect(wrapper.text()).toContain("Loading…");
  });

  it("shows the empty state when there are no notifications", () => {
    const wrapper = mountDropdown();
    expect(wrapper.text()).toContain("You're all caught up");
  });

  it("renders grouped notification items and a dismiss-all button", async () => {
    entries.value = [makeActivity("a1"), makeActivity("a2")];
    const wrapper = mountDropdown();
    await nextTick();
    expect(wrapper.findAllComponents({ name: "NotificationItem" }).length).toBeGreaterThan(0);
    const dismissAllBtn = wrapper.findAll("button").find((b) => b.text().includes("Dismiss all"));
    expect(dismissAllBtn).toBeTruthy();
    await dismissAllBtn!.trigger("click");
    expect(dismissAll).toHaveBeenCalled();
  });

  it("forwards dismiss and navigate from notification items", async () => {
    entries.value = [makeActivity("a1")];
    const wrapper = mountDropdown();
    await nextTick();
    const item = wrapper.findComponent({ name: "NotificationItem" });
    item.vm.$emit("dismiss", ["a1"]);
    item.vm.$emit("navigate", "/libraries/lib1");
    expect(dismiss).toHaveBeenCalledWith("a1");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("shows a 'See all' button when there is more and navigates to /notifications", async () => {
    entries.value = [makeActivity("a1")];
    nextCursor.value = "cursor-2";
    const wrapper = mountDropdown();
    await nextTick();
    const seeAll = wrapper.findAll("button").find((b) => b.text().includes("See all"));
    expect(seeAll).toBeTruthy();
    await seeAll!.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });
});
