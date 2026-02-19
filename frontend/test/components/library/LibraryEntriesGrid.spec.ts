import { mount } from "@vue/test-utils";
import LibraryEntriesGrid from "~/components/library/LibraryEntriesGrid.vue";
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  AlcovesImage: { template: "<img />", props: ["libraryId", "fileId", "alt", "width", "height", "format", "quality", "class"] },
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
    size: 1024,
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
    updatedAt: "2024-01-01",
    owner: null,
    tags: [],
    ...overrides,
  };
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    entries: [] as LibraryEntry[],
    libraryId: "lib-1",
    showTrashed: false,
    dragEnabled: true,
    draggedFileIds: [] as string[],
    dropTargetFolderId: null,
    renameValue: "",
    isEntrySelected: () => false,
    isRenaming: () => false,
    failedThumbnails: new Set<string>(),
    isImageFile: (f: LibraryFile) => f.mimeType.startsWith("image/"),
    isSmallImage: () => false,
    cardThumbWidth: () => 400,
    cardThumbHeight: () => 300,
    ...overrides,
  };
}

describe("LibraryEntriesGrid", () => {
  it("renders nothing when entries are empty", () => {
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps(),
      global: { stubs },
    });
    expect(wrapper.findAll("[class*='cursor-pointer']")).toHaveLength(0);
  });

  it("renders folder entries with folder icon and name", () => {
    const folder = makeFolder({ name: "Photos" });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [folder] }),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Photos");
  });

  it("renders file entries with file name", () => {
    const file = makeFile({ name: "document.pdf", mimeType: "application/pdf" });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("document.pdf");
  });

  it("shows trashed folder with file count", () => {
    const folder = makeFolder({ name: "Trash Folder", trashFileCount: 5 });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [folder], showTrashed: true }),
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Trash Folder (5 files)");
  });

  it("applies selected styling when entry is selected", () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({
        entries: [file],
        isEntrySelected: () => true,
      }),
      global: { stubs },
    });
    const card = wrapper.find(".cursor-pointer");
    expect(card.classes()).toContain("bg-primary/20");
  });

  it("applies drop target styling on folder", () => {
    const folder = makeFolder({ id: "target-folder" });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({
        entries: [folder],
        dropTargetFolderId: "target-folder",
      }),
      global: { stubs },
    });
    const card = wrapper.find(".cursor-pointer");
    expect(card.classes()).toContain("ring-2");
  });

  it("applies dragged opacity on dragged files", () => {
    const file = makeFile({ id: "dragged-file" });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({
        entries: [file],
        draggedFileIds: ["dragged-file"],
      }),
      global: { stubs },
    });
    const card = wrapper.find(".cursor-pointer");
    expect(card.classes()).toContain("opacity-60");
  });

  it("emits rowClick on card click", async () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    await wrapper.find(".cursor-pointer").trigger("click");
    expect(wrapper.emitted("rowClick")).toBeTruthy();
    expect(wrapper.emitted("rowClick")![0]![0]).toEqual(file);
  });

  it("emits rowDoubleClick on card dblclick", async () => {
    const folder = makeFolder();
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [folder] }),
      global: { stubs },
    });
    await wrapper.find(".cursor-pointer").trigger("dblclick");
    expect(wrapper.emitted("rowDoubleClick")).toBeTruthy();
    expect(wrapper.emitted("rowDoubleClick")![0]![0]).toEqual(folder);
  });

  it("emits rowContextMenu on right click", async () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    await wrapper.find(".cursor-pointer").trigger("contextmenu");
    expect(wrapper.emitted("rowContextMenu")).toBeTruthy();
  });

  it("shows rename input when isRenaming returns true", () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesGrid, {
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
    const wrapper = mount(LibraryEntriesGrid, {
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
    const wrapper = mount(LibraryEntriesGrid, {
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

  it("renders image thumbnail for image files", () => {
    const file = makeFile({ mimeType: "image/jpeg" });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({
        entries: [file],
        isImageFile: () => true,
      }),
      global: { stubs },
    });
    // AlcovesImage stub renders as <img>
    expect(wrapper.find("img").exists()).toBe(true);
  });

  it("renders video processing spinner for video with processing proxy", () => {
    const file = makeFile({
      mimeType: "video/mp4",
      proxyStatus: "processing",
    });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({
        entries: [file],
        isImageFile: () => false,
      }),
      global: { stubs },
    });
    expect(wrapper.find(".loading-spinner").exists()).toBe(true);
  });

  it("renders tags as colored dots", () => {
    const file = makeFile({
      tags: [
        { id: "tag-1", libraryId: "lib-1", name: "Important", color: "#ff0000", createdAt: "", updatedAt: "" },
        { id: "tag-2", libraryId: "lib-1", name: "Work", color: "#00ff00", createdAt: "", updatedAt: "" },
      ],
    });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [file] }),
      global: { stubs },
    });
    const dots = wrapper.findAll(".rounded-full[title]");
    expect(dots).toHaveLength(2);
    expect(dots[0]!.attributes("title")).toBe("Important");
    expect(dots[1]!.attributes("title")).toBe("Work");
  });

  it("sets draggable on file entries when drag is enabled", () => {
    const file = makeFile();
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [file], dragEnabled: true }),
      global: { stubs },
    });
    expect(wrapper.find(".cursor-pointer").attributes("draggable")).toBe("true");
  });

  it("does not set draggable on folders", () => {
    const folder = makeFolder();
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({ entries: [folder], dragEnabled: true }),
      global: { stubs },
    });
    expect(wrapper.find(".cursor-pointer").attributes("draggable")).toBe("false");
  });

  it("emits thumbnailError when AlcovesImage has error", async () => {
    const file = makeFile({
      mimeType: "image/jpeg",
      id: "img-fail",
    });
    const wrapper = mount(LibraryEntriesGrid, {
      props: defaultProps({
        entries: [file],
        isImageFile: () => true,
      }),
      global: { stubs },
    });
    // Find the AlcovesImage stub and trigger error
    const img = wrapper.find("img");
    await img.trigger("error");
    expect(wrapper.emitted("thumbnailError")).toBeTruthy();
    expect(wrapper.emitted("thumbnailError")![0]![0]).toBe("img-fail");
  });
});
