import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import NotificationItem from "~/components/notifications/NotificationItem.vue";
import type { Activity } from "~~/shared/types/api";
import type { ActivityGroup } from "~/utils/activity-format";

function makeGroup(over: Partial<Activity> = {}, count = 1): ActivityGroup {
  const head: Activity = {
    id: "id-head",
    libraryId: "lib-1",
    libraryName: "Family",
    actor: { id: "u1", displayName: "Alice", avatarUrl: null },
    action: "file.created",
    subjectType: "file",
    subjectId: "file-1",
    metadata: { name: "photo.jpg" },
    createdAt: new Date().toISOString(),
    dismissed: false,
    ...over,
  };
  return { head, items: [head], count };
}

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  UserAvatar: { template: "<div class='avatar' />", props: ["user", "size", "displayName", "avatarUrl", "sizeClass"] },
};

describe("NotificationItem", () => {
  it("renders actor display name and file name", () => {
    const wrapper = mount(NotificationItem, {
      props: { group: makeGroup(), showLibraryName: false, showDismiss: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Alice added photo.jpg");
  });

  it("renders library name when showLibraryName is true", () => {
    const wrapper = mount(NotificationItem, {
      props: { group: makeGroup(), showLibraryName: true, showDismiss: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Family");
  });

  it("renders bulk format for grouped file.created", () => {
    const head: Activity = {
      id: "h",
      libraryId: "lib-1",
      actor: { id: "u1", displayName: "Alice", avatarUrl: null },
      action: "file.created",
      subjectType: "file",
      subjectId: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      dismissed: false,
    };
    const wrapper = mount(NotificationItem, {
      props: { group: { head, items: [head, head, head], count: 3 }, showLibraryName: false, showDismiss: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Alice added 3 files");
  });

  it("renders an <a> when href is available", () => {
    const wrapper = mount(NotificationItem, {
      props: { group: makeGroup(), showLibraryName: false, showDismiss: false },
      global: { stubs },
    });
    expect(wrapper.element.tagName.toLowerCase()).toBe("a");
  });

  it("renders a <div> for actions without href (e.g. file.deleted)", () => {
    const wrapper = mount(NotificationItem, {
      props: {
        group: makeGroup({ action: "file.deleted", metadata: { name: "x" } }),
        showLibraryName: false,
        showDismiss: false,
      },
      global: { stubs },
    });
    expect(wrapper.element.tagName.toLowerCase()).toBe("div");
  });

  it("emits dismiss with the activity ids when X is clicked", async () => {
    const wrapper = mount(NotificationItem, {
      props: { group: makeGroup(), showLibraryName: false, showDismiss: true },
      global: { stubs },
    });
    const btn = wrapper.find("button[aria-label='Dismiss notification']");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(wrapper.emitted("dismiss")?.[0]?.[0]).toEqual(["id-head"]);
  });

  it("does not render dismiss button when showDismiss=false", () => {
    const wrapper = mount(NotificationItem, {
      props: { group: makeGroup(), showLibraryName: false, showDismiss: false },
      global: { stubs },
    });
    expect(wrapper.find("button[aria-label='Dismiss notification']").exists()).toBe(false);
  });

  it("emits navigate with href when row clicked", async () => {
    const wrapper = mount(NotificationItem, {
      props: { group: makeGroup(), showLibraryName: false, showDismiss: false },
      global: { stubs },
    });
    await wrapper.trigger("click");
    const [[href]] = wrapper.emitted("navigate") as string[][];
    expect(href).toMatch(/^\/libraries\/lib-1/);
  });

  it("does not emit navigate when modifier key is held", async () => {
    const wrapper = mount(NotificationItem, {
      props: { group: makeGroup(), showLibraryName: false, showDismiss: false },
      global: { stubs },
    });
    await wrapper.trigger("click", { ctrlKey: true });
    expect(wrapper.emitted("navigate")).toBeUndefined();
  });
});
