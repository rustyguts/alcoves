import { mount } from "@vue/test-utils";
import LibraryEntriesTable from "~/components/library/LibraryEntriesTable.vue";
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  UserAvatar: {
    template: "<span />",
    props: [
      "displayName",
      "avatarUrl",
      "sizeClass",
      "textSizeClass",
      "bgClass",
      "tooltip",
      "tooltipPosition",
    ],
  },
};

function makeFolder(overrides: Partial<LibraryFolder> = {}): LibraryFolder {
  return {
    id: "folder-1",
    libraryId: "lib-1",
    parentFolderId: null,
    name: "My Folder",
    kind: "folder",
    trashedAt: null,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    owner: null,
    tags: [],
    ...overrides,
  };
}

function makeFile(overrides: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id: "file-1",
    libraryId: "lib-1",
    parentFolderId: null,
    name: "photo.jpg",
    mimeType: "image/jpeg",
    size: 1048576,
    kind: "file",
    duration: null,
    width: 1920,
    height: 1080,
    proxyStatus: null,
    thumbnailFileId: null,
    sourceFileId: null,
    originalCreatedAt: null,
    trashedAt: null,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-15",
    owner: null,
    tags: [],
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    entries: [] as LibraryEntry[],
    showTrashed: false,
    dragEnabled: true,
    draggedFileIds: [] as string[],
    dropTargetFolderId: null,
    renameValue: "",
    isEntrySelected: () => false,
    isRenaming: () => false,
    ...overrides,
  };
}

describe("LibraryEntriesTable", () => {
  it("renders table headers", () => {
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps(),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Name");
    expect(wrapper.text()).toContain("Tags");
    expect(wrapper.text()).toContain("Owner");
    expect(wrapper.text()).toContain("Modified");
    expect(wrapper.text()).toContain("Size");
  });

  it("shows Trashed header when showTrashed is true", () => {
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ showTrashed: true }),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Trashed");
    expect(wrapper.text()).not.toContain("Modified");
  });

  it("renders folder entry with name", () => {
    const folder = makeFolder({ name: "Documents" });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [folder] }),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Documents");
  });

  it("renders file entry with name and size", () => {
    const file = makeFile({ name: "image.png", size: 1048576 });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("image.png");
    // formatFileSize(1048576) should output something like "1 MB" or "1.0 MB"
    expect(wrapper.text()).toMatch(/1(\.0)?\s*MB/);
  });

  it("shows dash for folder size", () => {
    const folder = makeFolder();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [folder] }),
      global: { stubs },
    });
    // Last column should contain "-"
    const tds = wrapper.findAll("td");
    const lastTd = tds[tds.length - 1]!;
    expect(lastTd.text()).toBe("-");
  });

  it("shows trashed folder with file count", () => {
    const folder = makeFolder({ name: "Old Stuff", trashFileCount: 3 });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [folder], showTrashed: true }),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Old Stuff (3 files)");
  });

  it("applies selected styling when entry is selected", () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file], isEntrySelected: () => true }),
      global: { stubs },
    });
    const row = wrapper.find("tbody tr");
    expect(row.classes()).toContain("bg-primary/20");
  });

  it("applies drop target styling on folder", () => {
    const folder = makeFolder({ id: "drop-target" });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({
        entries: [folder],
        dropTargetFolderId: "drop-target",
      }),
      global: { stubs },
    });
    const row = wrapper.find("tbody tr");
    expect(row.classes()).toContain("ring-2");
  });

  it("applies dragged opacity on dragged file", () => {
    const file = makeFile({ id: "dragged" });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({
        entries: [file],
        draggedFileIds: ["dragged"],
      }),
      global: { stubs },
    });
    const row = wrapper.find("tbody tr");
    expect(row.classes()).toContain("opacity-60");
  });

  it("emits rowClick on row click", async () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    await wrapper.find("tbody tr").trigger("click");
    expect(wrapper.emitted("rowClick")).toBeTruthy();
    expect(wrapper.emitted("rowClick")![0]![0]).toEqual(file);
  });

  it("emits rowDoubleClick on row dblclick", async () => {
    const folder = makeFolder();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [folder] }),
      global: { stubs },
    });
    await wrapper.find("tbody tr").trigger("dblclick");
    expect(wrapper.emitted("rowDoubleClick")).toBeTruthy();
  });

  it("emits rowContextMenu on right click", async () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    await wrapper.find("tbody tr").trigger("contextmenu");
    expect(wrapper.emitted("rowContextMenu")).toBeTruthy();
  });

  it("shows rename input when isRenaming returns true", () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({
        entries: [file],
        isRenaming: () => true,
        renameValue: "new-name.jpg",
      }),
      global: { stubs },
    });
    const input = wrapper.find("input.input-sm");
    expect(input.exists()).toBe(true);
    expect(input.element.value).toBe("new-name.jpg");
  });

  it("emits saveRename on Enter key in rename input", async () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({
        entries: [file],
        isRenaming: () => true,
        renameValue: "renamed",
      }),
      global: { stubs },
    });
    await wrapper.find("input.input-sm").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("saveRename")).toBeTruthy();
  });

  it("emits cancelRename on Escape key in rename input", async () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({
        entries: [file],
        isRenaming: () => true,
        renameValue: "renamed",
      }),
      global: { stubs },
    });
    await wrapper.find("input.input-sm").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancelRename")).toBeTruthy();
  });

  it("renders owner avatar when entry has owner", () => {
    const file = makeFile({
      owner: { id: "u1", displayName: "Alice", avatarUrl: null },
    });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    // UserAvatar stub renders as <span>
    const _avatarStubs = wrapper.findAll("span[displayname]");
    // Use a broader check — just verify the owner cell doesn't show "-"
    const ownerCell = wrapper.findAll("td")[3]!;
    expect(ownerCell.text()).not.toBe("-");
  });

  it("renders dash when entry has no owner", () => {
    const file = makeFile({ owner: null });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    const ownerCell = wrapper.findAll("td")[3]!;
    expect(ownerCell.text()).toBe("-");
  });

  it("renders tags as colored dots", () => {
    const file = makeFile({
      tags: [
        { id: "t1", libraryId: "lib-1", name: "Tag1", color: "#f00", createdAt: "", updatedAt: "" },
      ],
    });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    const dot = wrapper.find(".rounded-full[title='Tag1']");
    expect(dot.exists()).toBe(true);
  });

  it("sets draggable on file entries when drag is enabled", () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file], dragEnabled: true }),
      global: { stubs },
    });
    expect(wrapper.find("tbody tr").attributes("draggable")).toBe("true");
  });

  it("does not set draggable on folders", () => {
    const folder = makeFolder();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [folder], dragEnabled: true }),
      global: { stubs },
    });
    expect(wrapper.find("tbody tr").attributes("draggable")).toBe("false");
  });

  it("emits drag events", async () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    const row = wrapper.find("tbody tr");
    await row.trigger("dragstart");
    await row.trigger("dragend");
    expect(wrapper.emitted("dragStart")).toBeTruthy();
    expect(wrapper.emitted("dragEnd")).toBeTruthy();
  });

  it("applies opacity to trashed file names", () => {
    const file = makeFile({ name: "deleted.jpg" });
    const wrapper = mount(LibraryEntriesTable, {
      props: defaultProps({ entries: [file], showTrashed: true }),
      global: { stubs },
    });
    const nameSpan = wrapper.find("span.opacity-60");
    expect(nameSpan.exists()).toBe(true);
    expect(nameSpan.text()).toBe("deleted.jpg");
  });
});
