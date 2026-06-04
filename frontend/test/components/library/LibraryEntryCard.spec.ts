import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LibraryEntryCard from "~/components/library/LibraryEntryCard.vue";
import type { LibraryEntry } from "~~/shared/types/api";

const stubs = {
  AppIcon: { template: "<i :data-name='name' />", props: ["name", "class"] },
  AlcovesImage: {
    template: "<img class='alcoves-image' @error=\"$emit('error')\" />",
    props: ["libraryId", "fileId", "alt", "width", "height", "format", "quality"],
    emits: ["error"],
  },
};

function fileEntry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: "f1",
    kind: "file",
    name: "clip.mp4",
    mimeType: "video/mp4",
    thumbnailFileId: null,
    proxyStatus: null,
    tags: [],
    ...over,
  } as LibraryEntry;
}

function folderEntry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return { id: "fo1", kind: "folder", name: "Trips", tags: [], ...over } as LibraryEntry;
}

function mountCard(entry: LibraryEntry, over: Record<string, unknown> = {}) {
  return mount(LibraryEntryCard, {
    global: { stubs },
    props: {
      entry,
      libraryId: "lib1",
      showTrashed: false,
      dragEnabled: true,
      draggedFileIds: [],
      dropTargetFolderId: null,
      renameValue: "",
      isEntrySelected: () => false,
      isRenaming: () => false,
      failedThumbnails: new Set<string>(),
      isImageFile: (f: { mimeType: string }) => f.mimeType.startsWith("image/"),
      isSmallImage: () => false,
      cardThumbWidth: () => 320,
      cardThumbHeight: () => 180,
      ...over,
    },
  });
}

describe("LibraryEntryCard", () => {
  it("renders a file name", () => {
    expect(mountCard(fileEntry()).text()).toContain("clip.mp4");
  });

  it("renders a folder name with the trashed file count", () => {
    const wrapper = mountCard(folderEntry({ trashFileCount: 3 }), { showTrashed: true });
    expect(wrapper.text()).toContain("Trips (3 files)");
  });

  it("emits row interactions", async () => {
    const wrapper = mountCard(fileEntry());
    const root = wrapper.find("div");
    await root.trigger("click");
    await root.trigger("dblclick");
    await root.trigger("contextmenu");
    expect(wrapper.emitted("rowClick")).toBeTruthy();
    expect(wrapper.emitted("rowDoubleClick")).toBeTruthy();
    expect(wrapper.emitted("rowContextMenu")).toBeTruthy();
  });

  it("emits drag lifecycle events", async () => {
    const wrapper = mountCard(fileEntry());
    const root = wrapper.find("div");
    await root.trigger("dragstart");
    await root.trigger("dragend");
    await root.trigger("dragenter");
    await root.trigger("dragover");
    await root.trigger("dragleave");
    await root.trigger("drop");
    for (const e of ["dragStart", "dragEnd", "dragEnter", "dragOver", "dragLeave", "drop"]) {
      expect(wrapper.emitted(e), e).toBeTruthy();
    }
  });

  it("shows a rename input and forwards rename events", async () => {
    const wrapper = mountCard(fileEntry(), { isRenaming: () => true, renameValue: "old" });
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);
    await input.setValue("new");
    await input.trigger("keydown.enter");
    await input.trigger("keydown.escape");
    expect(wrapper.emitted("updateRenameValue")).toBeTruthy();
    expect(wrapper.emitted("saveRename")).toBeTruthy();
    expect(wrapper.emitted("cancelRename")).toBeTruthy();
  });

  it("flags duplicates with a tooltip", () => {
    const wrapper = mountCard(fileEntry({ hasDuplicates: true }));
    expect(wrapper.findComponent({ name: "UTooltip" }).exists()).toBe(true);
  });

  it("renders tag swatches", () => {
    const wrapper = mountCard(fileEntry({ tags: [{ id: "t1", name: "blue", color: "#00f" }] as never }));
    expect(wrapper.html()).toContain("#00f");
  });

  it("emits thumbnailError when the fallback image fails", async () => {
    const wrapper = mountCard(fileEntry({ thumbnailFileId: null }));
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    await img.trigger("error");
    expect(wrapper.emitted("thumbnailError")?.[0]).toEqual(["f1"]);
  });

  it("uses AlcovesImage for a video with a thumbnail and forwards its error", async () => {
    const wrapper = mountCard(fileEntry({ thumbnailFileId: "thumb-1" }));
    const img = wrapper.find(".alcoves-image");
    expect(img.exists()).toBe(true);
    await img.trigger("error");
    expect(wrapper.emitted("thumbnailError")?.[0]).toEqual(["f1"]);
  });

  it("shows a processing overlay for a video proxy in progress", () => {
    const wrapper = mountCard(fileEntry({ thumbnailFileId: null, proxyStatus: "processing" }));
    expect(wrapper.html()).toContain("animate-spin");
  });
});
