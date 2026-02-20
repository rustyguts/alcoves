import { mount } from "@vue/test-utils";
import LibraryIndexPage from "~/pages/libraries/[id]/index.vue";
import type { LibraryEntry, LibraryFile, LibraryFolder, LibraryTag } from "~~/shared/types/api";

function mockRef<T>(get: () => T, set?: (value: T) => void) {
  return {
    __v_isRef: true as const,
    get value() {
      return get();
    },
    set value(v: T) {
      set?.(v);
    },
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

// Shared mutable state used by composable mocks
const mocks = vi.hoisted(() => ({
  library: {
    id: "lib-1",
    name: "Test Library",
    emoji: null as string | null,
    isDefault: false,
    faceRecognitionEnabled: false,
    ownerId: "user-1",
    currentUserRole: "owner" as "owner" | "admin" | "viewer",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  },
  routePath: "/libraries/lib-1",
  routeParamsId: "lib-1",
  routeQuery: {} as Record<string, string>,
  routerPush: vi.fn(),
  toast: { add: vi.fn() },
  apiFetch: vi.fn().mockResolvedValue({}),
  refreshLibraries: vi.fn(),

  // useLibraryExplorer state
  entries: [] as LibraryEntry[],
  filesPending: false,
  showTrashed: false,
  viewMode: "files" as string,
  entryViewMode: "file" as "file" | "card",
  canManageLibrary: true,
  currentFolderId: null as string | null,
  breadcrumbs: [] as Array<{ id: string; name: string }>,
  nextCursor: null as string | null,
  totalCount: 0,
  trashedCount: 0,
  loadingMore: false,
  libraryTags: [] as LibraryTag[],
  selectedFiles: new Set<string>(),
  selectedFolders: new Set<string>(),
  lastClickedIndex: null as number | null,
  clearSelection: vi.fn(),
  isEntrySelected: vi.fn(() => false),
  fetchPage: vi.fn(),
  loadMore: vi.fn(),
  resetAndFetch: vi.fn(),
  refreshTags: vi.fn(),
  refreshTrashedCount: vi.fn(),
  refreshFolders: vi.fn().mockResolvedValue([]),
  openFolder: vi.fn(),
  buildFolderQuery: vi.fn(() => ({})),
  refreshLibrary: vi.fn(),
  isTrashRoute: false,

  // useLibraryTags
  isFolderTagAssigned: vi.fn(() => false),
  areAllFilesTagged: vi.fn(() => false),
  toggleTagForFolder: vi.fn(),
  toggleTagForFiles: vi.fn(),

  // useDownloadZip
  zipDownloading: false,
  showSizeWarning: false,
  estimatedFileCount: 0,
  formattedEstimatedSize: "0 B",
  startZipDownload: vi.fn(),
  confirmLargeDownload: vi.fn(),
  cancelLargeDownload: vi.fn(),

  // useLibraryFolderActions
  createFolderOpen: false,
  createFolderName: "",
  creatingFolder: false,
  openCreateFolderModal: vi.fn(),
  createFolder: vi.fn(),
  moveFolderOpen: false,
  movingFolder: null,
  moveDestinationValue: "__root__",
  moveLoading: false,
  moveFolderSaving: false,
  moveDestinationOptions: [],
  openMoveFolderModal: vi.fn(),
  moveFolder: vi.fn(),
  deleteFolders: vi.fn(),
  deleteFolder: vi.fn(),

  // useUploadQueue
  addFiles: vi.fn(),
  onLibraryUploadComplete: vi.fn(),
  removeOnComplete: vi.fn(),
  onLibraryUploadSuccess: vi.fn(),
  removeOnSuccess: vi.fn(),

  // useFileDrop
  isOverDropZone: false,
}));

vi.mock("~/composables/useToast", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    RouterLink: { template: "<a :href='to'><slot /></a>", props: ["to"] },
    useRoute: () => ({
      path: mocks.routePath,
      params: { id: mocks.routeParamsId },
      query: mocks.routeQuery,
      fullPath: mocks.routePath,
    }),
    useRouter: () => ({
      push: mocks.routerPush,
      replace: vi.fn(),
      currentRoute: { value: { path: mocks.routePath, query: mocks.routeQuery } },
    }),
  };
});

vi.mock("~/composables/useLibraryExplorer", () => ({
  useLibraryExplorer: () => ({
    route: {
      path: mocks.routePath,
      params: { id: mocks.routeParamsId },
      query: mocks.routeQuery,
    },
    libraryId: mockRef(() => mocks.routeParamsId),
    user: mockRef(() => ({ id: "user-1" })),
    library: mockRef(() => mocks.library),
    refreshLibrary: mocks.refreshLibrary,
    isTrashRoute: mockRef(() => mocks.isTrashRoute),
    viewMode: mockRef(
      () => mocks.viewMode,
      (v: string) => {
        mocks.viewMode = v;
      },
    ),
    entryViewMode: mockRef(
      () => mocks.entryViewMode,
      (v: "file" | "card") => {
        mocks.entryViewMode = v;
      },
    ),
    showTrashed: mockRef(() => mocks.showTrashed),
    canManageLibrary: mockRef(() => mocks.canManageLibrary),
    currentFolderId: mockRef(() => mocks.currentFolderId),
    buildFolderQuery: mocks.buildFolderQuery,
    openFolder: mocks.openFolder,
    entries: mockRef(
      () => mocks.entries,
      (v: LibraryEntry[]) => {
        mocks.entries = v;
      },
    ),
    breadcrumbs: mockRef(
      () => mocks.breadcrumbs,
      (v: Array<{ id: string; name: string }>) => {
        mocks.breadcrumbs = v;
      },
    ),
    nextCursor: mockRef(
      () => mocks.nextCursor,
      (v: string | null) => {
        mocks.nextCursor = v;
      },
    ),
    totalCount: mockRef(
      () => mocks.totalCount,
      (v: number) => {
        mocks.totalCount = v;
      },
    ),
    trashedCount: mockRef(
      () => mocks.trashedCount,
      (v: number) => {
        mocks.trashedCount = v;
      },
    ),
    libraryTags: mockRef(() => mocks.libraryTags),
    loadingMore: mockRef(() => mocks.loadingMore),
    filesPending: mockRef(() => mocks.filesPending),
    files: mockRef(() => mocks.entries.filter((e): e is LibraryFile => e.kind === "file")),
    folders: mockRef(() => mocks.entries.filter((e): e is LibraryFolder => e.kind === "folder")),
    selectedFiles: mocks.selectedFiles,
    selectedFolders: mocks.selectedFolders,
    lastClickedIndex: mockRef(
      () => mocks.lastClickedIndex,
      (v: number | null) => {
        mocks.lastClickedIndex = v;
      },
    ),
    clearSelection: mocks.clearSelection,
    isEntrySelected: mocks.isEntrySelected,
    fetchPage: mocks.fetchPage,
    loadMore: mocks.loadMore,
    resetAndFetch: mocks.resetAndFetch,
    refreshTags: mocks.refreshTags,
    refreshTrashedCount: mocks.refreshTrashedCount,
    refreshFolders: mocks.refreshFolders,
  }),
}));

vi.mock("~/composables/useLibraryTags", () => ({
  useLibraryTags: () => ({
    isFolderTagAssigned: mocks.isFolderTagAssigned,
    areAllFilesTagged: mocks.areAllFilesTagged,
    toggleTagForFolder: mocks.toggleTagForFolder,
    toggleTagForFiles: mocks.toggleTagForFiles,
  }),
}));

vi.mock("~/composables/useDownloadZip", () => ({
  useDownloadZip: () => ({
    downloading: mockRef(() => mocks.zipDownloading),
    showSizeWarning: mockRef(() => mocks.showSizeWarning),
    estimatedFileCount: mockRef(() => mocks.estimatedFileCount),
    formattedEstimatedSize: mockRef(() => mocks.formattedEstimatedSize),
    startDownload: mocks.startZipDownload,
    confirmLargeDownload: mocks.confirmLargeDownload,
    cancelLargeDownload: mocks.cancelLargeDownload,
  }),
}));

vi.mock("~/composables/useLibraryFolderActions", () => ({
  useLibraryFolderActions: () => ({
    createFolderOpen: mockRef(
      () => mocks.createFolderOpen,
      (v: boolean) => {
        mocks.createFolderOpen = v;
      },
    ),
    createFolderName: mockRef(
      () => mocks.createFolderName,
      (v: string) => {
        mocks.createFolderName = v;
      },
    ),
    creatingFolder: mockRef(() => mocks.creatingFolder),
    openCreateFolderModal: mocks.openCreateFolderModal,
    createFolder: mocks.createFolder,
    moveFolderOpen: mockRef(
      () => mocks.moveFolderOpen,
      (v: boolean) => {
        mocks.moveFolderOpen = v;
      },
    ),
    movingFolder: mockRef(() => mocks.movingFolder),
    moveDestinationValue: mockRef(
      () => mocks.moveDestinationValue,
      (v: string) => {
        mocks.moveDestinationValue = v;
      },
    ),
    moveLoading: mockRef(() => mocks.moveLoading),
    moveFolderSaving: mockRef(() => mocks.moveFolderSaving),
    moveDestinationOptions: mockRef(() => mocks.moveDestinationOptions),
    openMoveFolderModal: mocks.openMoveFolderModal,
    moveFolder: mocks.moveFolder,
    deleteFolders: mocks.deleteFolders,
    deleteFolder: mocks.deleteFolder,
  }),
}));

vi.mock("~/composables/useUploadQueue", () => ({
  useUploadQueue: () => ({
    addFiles: mocks.addFiles,
    onLibraryUploadComplete: mocks.onLibraryUploadComplete,
    removeOnComplete: mocks.removeOnComplete,
    onLibraryUploadSuccess: mocks.onLibraryUploadSuccess,
    removeOnSuccess: mocks.removeOnSuccess,
  }),
}));

vi.mock("~/composables/useFileDrop", () => ({
  useFileDrop: () => ({
    isOverDropZone: mockRef(() => mocks.isOverDropZone),
    dropZoneProps: {},
  }),
}));

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  EmojiPicker: { template: "<span data-stub='emoji' />", props: ["modelValue"] },
  UploadModal: {
    template: "<div data-stub='upload' />",
    props: ["open", "libraryId", "libraryName", "parentFolderId"],
  },
  FilePreview: {
    template: "<div data-stub='preview' />",
    props: ["open", "file", "libraryId", "files"],
  },
  ClipModal: { template: "<div data-stub='clip' />", props: ["open", "file", "libraryId"] },
  AppContextMenu: { template: "<div data-stub='ctx'><slot /></div>", props: ["open", "position"] },
  ContextMenuItemsRenderer: { template: "<div data-stub='ctx-items' />", props: ["groups"] },
  LibraryEntriesGrid: {
    template: "<div data-stub='grid' />",
    props: [
      "entries",
      "libraryId",
      "showTrashed",
      "dragEnabled",
      "draggedFileIds",
      "dropTargetFolderId",
      "renameValue",
      "isEntrySelected",
      "isRenaming",
      "failedThumbnails",
      "isImageFile",
      "isSmallImage",
      "cardThumbWidth",
      "cardThumbHeight",
    ],
  },
  LibraryEntriesTable: {
    template: "<div data-stub='table' />",
    props: [
      "entries",
      "showTrashed",
      "dragEnabled",
      "draggedFileIds",
      "dropTargetFolderId",
      "renameValue",
      "isEntrySelected",
      "isRenaming",
    ],
  },
  LibraryEmptyState: {
    template: "<div data-stub='empty' />",
    props: ["showTrashed", "title", "description", "canManageLibrary"],
  },
  LibraryEntriesSkeleton: {
    template: "<div data-stub='skeleton' />",
    props: ["entryViewMode", "showTrashed"],
  },
  LibraryTabs: {
    template: "<div data-stub='tabs' />",
    props: ["libraryId", "faceRecognitionEnabled", "canManageLibrary"],
  },
  AlcovesImage: { template: "<img />", props: ["libraryId", "fileId", "alt", "width", "height"] },
  RouterLink: { template: "<a :href='to'><slot /></a>", props: ["to"] },
};

// Stub localStorage and IntersectionObserver for jsdom
beforeAll(() => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.getItem !== "function") {
    const store: Record<string, string> = {};
    globalThis.localStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (idx: number) => Object.keys(store)[idx] ?? null,
    } as Storage;
  }

  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class IntersectionObserver {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.IntersectionObserver;
  }
});

describe("library index page", () => {
  const defaultLibrary = {
    id: "lib-1",
    name: "Test Library",
    emoji: null as string | null,
    isDefault: false,
    faceRecognitionEnabled: false,
    ownerId: "user-1",
    currentUserRole: "owner" as "owner" | "admin" | "viewer",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.entries = [];
    mocks.filesPending = false;
    mocks.showTrashed = false;
    mocks.canManageLibrary = true;
    mocks.currentFolderId = null;
    mocks.breadcrumbs = [];
    mocks.totalCount = 0;
    mocks.trashedCount = 0;
    mocks.loadingMore = false;
    mocks.entryViewMode = "file";
    mocks.viewMode = "files";
    mocks.isTrashRoute = false;
    mocks.library = { ...defaultLibrary };
    mocks.isOverDropZone = false;
    mocks.selectedFiles.clear();
    mocks.selectedFolders.clear();
    mocks.createFolderOpen = false;
  });

  function mountPage() {
    return mount(LibraryIndexPage, {
      global: {
        stubs,
        provide: {
          refreshLibraries: mocks.refreshLibraries,
        },
      },
    });
  }

  it("renders the library name as breadcrumb root", () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Test Library");
  });

  it("shows loading indicator when files are pending and no entries loaded", () => {
    mocks.filesPending = true;
    mocks.entries = [];
    const wrapper = mountPage();
    // Loading spinner text is present (not skeleton stub which was removed)
    expect(wrapper.text()).toContain("Loading");
  });

  it("shows empty state when no entries and not pending", () => {
    mocks.entries = [];
    mocks.filesPending = false;
    const wrapper = mountPage();
    expect(wrapper.find("[data-stub='empty']").exists()).toBe(true);
  });

  it("shows table view when entryViewMode is file and entries exist", () => {
    mocks.entryViewMode = "file";
    mocks.entries = [makeFile()];
    const wrapper = mountPage();
    expect(wrapper.find("[data-stub='table']").exists()).toBe(true);
    expect(wrapper.find("[data-stub='grid']").exists()).toBe(false);
  });

  it("shows grid view when entryViewMode is card and entries exist", () => {
    mocks.entryViewMode = "card";
    mocks.entries = [makeFile()];
    const wrapper = mountPage();
    expect(wrapper.find("[data-stub='grid']").exists()).toBe(true);
    expect(wrapper.find("[data-stub='table']").exists()).toBe(false);
  });

  it("shows New dropdown when user can manage library", () => {
    mocks.canManageLibrary = true;
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("New");
  });

  it("hides New dropdown when user cannot manage library", () => {
    mocks.canManageLibrary = false;
    const wrapper = mountPage();
    expect(wrapper.text()).not.toContain("New");
  });

  it("shows list/grid view toggle buttons", () => {
    const wrapper = mountPage();
    const listBtn = wrapper.find("button[title='List view']");
    const gridBtn = wrapper.find("button[title='Grid view']");
    expect(listBtn.exists()).toBe(true);
    expect(gridBtn.exists()).toBe(true);
  });

  it("hides view toggle buttons in trash mode", () => {
    mocks.showTrashed = true;
    const wrapper = mountPage();
    expect(wrapper.find("button[title='List view']").exists()).toBe(false);
    expect(wrapper.find("button[title='Grid view']").exists()).toBe(false);
  });

  it("shows Delete All button in trash mode with items", () => {
    mocks.showTrashed = true;
    mocks.totalCount = 5;
    mocks.filesPending = false;
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Delete All");
  });

  it("hides Delete All button when trash is empty", () => {
    mocks.showTrashed = true;
    mocks.totalCount = 0;
    const wrapper = mountPage();
    expect(wrapper.text()).not.toContain("Delete All");
  });

  it("shows drop zone overlay when dragging files over", () => {
    mocks.isOverDropZone = true;
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Drop files to upload to this folder");
  });

  it("renders breadcrumb items for nested folders", () => {
    mocks.breadcrumbs = [
      { id: "f1", name: "Documents" },
      { id: "f2", name: "Photos" },
    ];
    const wrapper = mountPage();
    expect(wrapper.text()).toContain("Test Library");
    expect(wrapper.text()).toContain("Documents");
    expect(wrapper.text()).toContain("Photos");
  });

  it("highlights list view button when in file mode", () => {
    mocks.entryViewMode = "file";
    const wrapper = mountPage();
    const listBtn = wrapper.find("button[title='List view']");
    expect(listBtn.classes()).toContain("btn-primary");
  });

  it("highlights grid view button when in card mode", () => {
    mocks.entryViewMode = "card";
    const wrapper = mountPage();
    const gridBtn = wrapper.find("button[title='Grid view']");
    expect(gridBtn.classes()).toContain("btn-primary");
  });
});
