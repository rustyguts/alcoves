import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { fnStub } from "../../support/fn-stub";
import MomentShareModal from "~/components/editor/MomentShareModal.vue";
import type { MomentShare } from "~~/shared/types/api";

const listShares = fnStub();
const createShare = fnStub();
const revokeShare = fnStub();
const toastAdd = vi.fn();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: () => Promise.resolve(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: {
    moments: {
      listShares: (...a: unknown[]) => listShares(...a),
      createShare: (...a: unknown[]) => createShare(...a),
      revokeShare: (...a: unknown[]) => revokeShare(...a),
    },
  },
}));

vi.mock("~/composables/useToast", () => ({ useToast: () => ({ add: toastAdd }) }));

function makeShare(over: Partial<MomentShare> = {}): MomentShare {
  return {
    id: "s1",
    momentId: "m1",
    libraryId: "lib1",
    token: "tok1",
    url: "https://share/tok1",
    revokedAt: null,
    createdAt: "",
    ...over,
  };
}

function mountModal(over: Record<string, unknown> = {}) {
  return mount(MomentShareModal, {
    props: {
      open: true,
      libraryId: "lib1",
      fileId: "file1",
      momentId: "m1",
      sharingEnabled: true,
      ...over,
    },
  });
}

const flush = async () => {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
};

describe("MomentShareModal", () => {
  beforeEach(() => {
    [listShares, createShare, revokeShare].forEach((s) => s.reset());
    toastAdd.mockReset();
  });

  it("loads shares when opened and renders the URLs", async () => {
    listShares.resolve([makeShare()]);
    const wrapper = mountModal({ open: false });
    await wrapper.setProps({ open: true });
    await flush();
    expect(listShares.calls[0]).toEqual(["lib1", "file1", "m1"]);
    expect(wrapper.text()).toContain("https://share/tok1");
  });

  it("shows an empty state when there are no shares", async () => {
    listShares.resolve([]);
    const wrapper = mountModal({ open: false });
    await wrapper.setProps({ open: true });
    await flush();
    expect(wrapper.text()).toContain("No active share links");
  });

  it("creates a share link and prepends it with a success toast", async () => {
    listShares.resolve([]);
    const wrapper = mountModal();
    await flush();
    createShare.resolve(makeShare({ id: "s2", token: "tok2", url: "https://share/tok2" }));
    const createBtn = wrapper.findAll("button").find((b) => b.text().includes("Create share link"));
    await createBtn!.trigger("click");
    await flush();
    expect(createShare.calls[0]).toEqual(["lib1", "file1", "m1"]);
    expect(wrapper.text()).toContain("https://share/tok2");
    expect(toastAdd).toHaveBeenCalledWith({ title: "Share link created", color: "success" });
  });

  it("toasts an error when share creation fails", async () => {
    listShares.resolve([]);
    const wrapper = mountModal();
    await flush();
    createShare.reject(new Error("boom"));
    const createBtn = wrapper.findAll("button").find((b) => b.text().includes("Create share link"));
    await createBtn!.trigger("click");
    await flush();
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to create share link", color: "error" });
  });

  it("disables creation when sharing is turned off for the library", async () => {
    listShares.resolve([]);
    const wrapper = mountModal({ sharingEnabled: false });
    await flush();
    const createBtn = wrapper.findAll("button").find((b) => b.text().includes("Create share link"));
    expect(createBtn!.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Sharing is disabled");
  });

  it("revokes a share link and removes it with a toast", async () => {
    listShares.resolve([makeShare()]);
    const wrapper = mountModal({ open: false });
    await wrapper.setProps({ open: true });
    await flush();
    revokeShare.resolve(undefined);
    const revokeBtn = wrapper.findAll("button").find((b) => b.text().includes("Revoke"));
    await revokeBtn!.trigger("click");
    await flush();
    expect(revokeShare.calls[0]).toEqual(["lib1", "file1", "m1", "tok1"]);
    expect(wrapper.text()).not.toContain("https://share/tok1");
    expect(toastAdd).toHaveBeenCalledWith({ title: "Share link revoked", color: "success" });
  });

  it("toasts an error when revoke fails", async () => {
    listShares.resolve([makeShare()]);
    const wrapper = mountModal({ open: false });
    await wrapper.setProps({ open: true });
    await flush();
    revokeShare.reject(new Error("boom"));
    const revokeBtn = wrapper.findAll("button").find((b) => b.text().includes("Revoke"));
    await revokeBtn!.trigger("click");
    await flush();
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to revoke", color: "error" });
  });

  it("copies a share URL to the clipboard with a success toast", async () => {
    listShares.resolve([makeShare()]);
    const wrapper = mountModal({ open: false });
    await wrapper.setProps({ open: true });
    await flush();
    const copyBtn = wrapper.find("button[aria-label='Copy link']");
    await copyBtn.trigger("click");
    await flush();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://share/tok1");
    expect(toastAdd).toHaveBeenCalledWith({ title: "Link copied", color: "success" });
  });

  it("falls back to an empty list when loading shares fails", async () => {
    listShares.reject(new Error("boom"));
    const wrapper = mountModal({ open: false });
    await wrapper.setProps({ open: true });
    await flush();
    expect(wrapper.text()).toContain("No active share links");
  });

  it("emits update:open when the modal requests to close", async () => {
    listShares.resolve([]);
    const wrapper = mountModal();
    await flush();
    // The UModal stub forwards update:open; emit directly through the component
    wrapper.findComponent({ name: "UModal" }).vm.$emit("update:open", false);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
