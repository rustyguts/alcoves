import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LibraryEntriesGrid from "~/components/library/LibraryEntriesGrid.vue";
import type { LibraryEntry } from "~~/shared/types/api";

const folder = { id: "fo1", kind: "folder", name: "Folder", tags: [] } as unknown as LibraryEntry;
const file = { id: "f1", kind: "file", name: "clip.mp4", mimeType: "video/mp4", tags: [] } as unknown as LibraryEntry;

const stubs = { LibraryEntryCard: { name: "LibraryEntryCard", template: "<div class='card' />" } };

function mountGrid(entries: LibraryEntry[]) {
  return mount(LibraryEntriesGrid, {
    global: { stubs },
    props: {
      entries,
      libraryId: "lib1",
      showTrashed: false,
      dragEnabled: true,
      draggedFileIds: [],
      dropTargetFolderId: null,
      renameValue: "",
      isEntrySelected: () => false,
      isRenaming: () => false,
      failedThumbnails: new Set<string>(),
      isImageFile: () => false,
      isSmallImage: () => false,
      cardThumbWidth: () => 320,
      cardThumbHeight: () => 180,
    },
  });
}

const EVENTS: Array<[string, unknown[]]> = [
  ["rowClick", [file, {} as MouseEvent]],
  ["rowDoubleClick", [file]],
  ["rowContextMenu", [file, {} as MouseEvent]],
  ["dragStart", [file, {} as DragEvent]],
  ["dragEnd", []],
  ["dragEnter", [file]],
  ["dragOver", [file, {} as DragEvent]],
  ["dragLeave", [file, {} as DragEvent]],
  ["drop", [file, {} as DragEvent]],
  ["saveRename", [file]],
  ["cancelRename", []],
  ["updateRenameValue", ["x"]],
  ["thumbnailError", ["f1"]],
];

describe("LibraryEntriesGrid", () => {
  it("splits folders and files into separate sections", () => {
    const wrapper = mountGrid([folder, file]);
    expect(wrapper.findAll("section")).toHaveLength(2);
    expect(wrapper.findAllComponents({ name: "LibraryEntryCard" })).toHaveLength(2);
  });

  it("renders only one section when there are no folders", () => {
    const wrapper = mountGrid([file]);
    expect(wrapper.findAll("section")).toHaveLength(1);
  });

  it("forwards every card event from both the folder and file sections", async () => {
    const wrapper = mountGrid([folder, file]);
    const cards = wrapper.findAllComponents({ name: "LibraryEntryCard" });
    for (const card of cards) {
      for (const [event, args] of EVENTS) {
        card.vm.$emit(event, ...args);
      }
    }
    for (const [event] of EVENTS) {
      expect(wrapper.emitted(event), event).toBeTruthy();
    }
    // each forwarded event fired once per card (folder + file)
    expect(wrapper.emitted("rowClick")).toHaveLength(2);
  });
});
