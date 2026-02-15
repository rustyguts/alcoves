import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useDownloadZip } from "~/composables/useDownloadZip";

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
  fetch: vi.fn(),
  globalFetch: vi.fn(),
}));

mockNuxtImport("useToast", () => () => mocks.toast);

describe("useDownloadZip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("$fetch", mocks.fetch);
    vi.stubGlobal("fetch", mocks.globalFetch);
    // Mock URL.createObjectURL and URL.revokeObjectURL
    vi.stubGlobal("URL", {
      ...globalThis.URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
  });

  function setup() {
    const libraryId = ref("lib-123");
    const composable = useDownloadZip(libraryId);
    return { libraryId, ...composable };
  }

  describe("startDownload", () => {
    it("fetches size estimate before downloading", async () => {
      mocks.fetch.mockResolvedValue({ totalSize: 1000, fileCount: 2 });
      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip"])),
      });

      const { startDownload } = setup();
      await startDownload(["file-1", "file-2"], []);

      expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-123/download-estimate", {
        method: "POST",
        body: { fileIds: ["file-1", "file-2"], folderIds: [] },
      });
    });

    it("initiates download for small files", async () => {
      mocks.fetch.mockResolvedValue({ totalSize: 1000, fileCount: 2 });
      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip"])),
      });

      const { startDownload } = setup();
      await startDownload(["file-1"], []);

      expect(mocks.globalFetch).toHaveBeenCalledWith("/api/libraries/lib-123/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: ["file-1"], folderIds: [], skipSizeCheck: false }),
      });
    });

    it("shows size warning for files exceeding 4GB", async () => {
      const hugeSize = 5 * 1024 * 1024 * 1024; // 5 GB
      mocks.fetch.mockResolvedValue({ totalSize: hugeSize, fileCount: 100 });

      const { startDownload, showSizeWarning, estimatedSize, estimatedFileCount } = setup();
      await startDownload(["file-1"], []);

      expect(showSizeWarning.value).toBe(true);
      expect(estimatedSize.value).toBe(hugeSize);
      expect(estimatedFileCount.value).toBe(100);
      expect(mocks.globalFetch).not.toHaveBeenCalled();
    });

    it("shows warning when no files found", async () => {
      mocks.fetch.mockResolvedValue({ totalSize: 0, fileCount: 0 });

      const { startDownload } = setup();
      await startDownload(["file-1"], []);

      expect(mocks.toast.add).toHaveBeenCalledWith({
        title: "No files to download",
        color: "warning",
      });
    });

    it("handles download error", async () => {
      mocks.fetch.mockResolvedValue({ totalSize: 1000, fileCount: 1 });
      mocks.globalFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ statusMessage: "Server error" }),
      });

      const { startDownload } = setup();
      await startDownload(["file-1"], []);

      expect(mocks.toast.add).toHaveBeenCalledWith({
        title: "Server error",
        color: "error",
      });
    });

    it("handles 413 error with size data", async () => {
      const hugeSize = 5 * 1024 * 1024 * 1024;
      mocks.fetch.mockResolvedValue({ totalSize: 1000, fileCount: 1 });
      mocks.globalFetch.mockResolvedValue({
        ok: false,
        status: 413,
        json: () =>
          Promise.resolve({
            data: { totalSize: hugeSize, fileCount: 500 },
          }),
      });

      const { startDownload, showSizeWarning, estimatedSize, estimatedFileCount } = setup();
      await startDownload(["file-1"], []);

      expect(showSizeWarning.value).toBe(true);
      expect(estimatedSize.value).toBe(hugeSize);
      expect(estimatedFileCount.value).toBe(500);
    });

    it("skips size check when skipSizeCheck is true", async () => {
      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip"])),
      });

      const { startDownload } = setup();
      await startDownload(["file-1"], [], true);

      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.globalFetch).toHaveBeenCalled();
    });

    it("sets downloading state correctly", async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mocks.fetch.mockReturnValue(promise);

      const { startDownload, downloading } = setup();
      expect(downloading.value).toBe(false);

      const downloadPromise = startDownload(["file-1"], []);
      expect(downloading.value).toBe(true);

      resolvePromise!({ totalSize: 0, fileCount: 0 });
      await downloadPromise;
      expect(downloading.value).toBe(false);
    });

    it("supports folder downloads", async () => {
      mocks.fetch.mockResolvedValue({ totalSize: 5000, fileCount: 10 });
      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip"])),
      });

      const { startDownload } = setup();
      await startDownload([], ["folder-1", "folder-2"]);

      expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-123/download-estimate", {
        method: "POST",
        body: { fileIds: [], folderIds: ["folder-1", "folder-2"] },
      });
      expect(mocks.globalFetch).toHaveBeenCalledWith("/api/libraries/lib-123/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds: [],
          folderIds: ["folder-1", "folder-2"],
          skipSizeCheck: false,
        }),
      });
    });

    it("supports mixed file and folder downloads", async () => {
      mocks.fetch.mockResolvedValue({ totalSize: 3000, fileCount: 5 });
      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip"])),
      });

      const { startDownload } = setup();
      await startDownload(["file-1"], ["folder-1"]);

      expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-123/download-estimate", {
        method: "POST",
        body: { fileIds: ["file-1"], folderIds: ["folder-1"] },
      });
    });

    it("creates download link with correct filename", async () => {
      mocks.fetch.mockResolvedValue({ totalSize: 100, fileCount: 1 });
      const mockBlob = new Blob(["zip-content"]);
      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      const clickSpy = vi.fn();
      vi.spyOn(document, "createElement").mockReturnValue({
        set href(_: string) {},
        set download(_: string) {},
        click: clickSpy,
      } as unknown as HTMLAnchorElement);

      const { startDownload } = setup();
      await startDownload(["file-1"], []);

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe("confirmLargeDownload", () => {
    it("proceeds with download skipping size check", async () => {
      const hugeSize = 5 * 1024 * 1024 * 1024;
      mocks.fetch.mockResolvedValue({ totalSize: hugeSize, fileCount: 100 });

      const { startDownload, confirmLargeDownload, showSizeWarning } = setup();
      await startDownload(["file-1"], []);

      expect(showSizeWarning.value).toBe(true);

      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip"])),
      });

      await confirmLargeDownload();
      expect(showSizeWarning.value).toBe(false);
      expect(mocks.globalFetch).toHaveBeenCalledWith("/api/libraries/lib-123/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: ["file-1"], folderIds: [], skipSizeCheck: true }),
      });
    });

    it("does nothing when no pending download", async () => {
      const { confirmLargeDownload } = setup();
      await confirmLargeDownload();
      expect(mocks.globalFetch).not.toHaveBeenCalled();
    });
  });

  describe("cancelLargeDownload", () => {
    it("resets warning state", async () => {
      const hugeSize = 5 * 1024 * 1024 * 1024;
      mocks.fetch.mockResolvedValue({ totalSize: hugeSize, fileCount: 100 });

      const {
        startDownload,
        cancelLargeDownload,
        showSizeWarning,
        estimatedSize,
        estimatedFileCount,
      } = setup();
      await startDownload(["file-1"], []);

      expect(showSizeWarning.value).toBe(true);

      cancelLargeDownload();
      expect(showSizeWarning.value).toBe(false);
      expect(estimatedSize.value).toBe(0);
      expect(estimatedFileCount.value).toBe(0);
    });
  });

  describe("formattedEstimatedSize", () => {
    it("formats size correctly", async () => {
      const hugeSize = 5 * 1024 * 1024 * 1024;
      mocks.fetch.mockResolvedValue({ totalSize: hugeSize, fileCount: 1 });

      const { startDownload, formattedEstimatedSize } = setup();
      await startDownload(["file-1"], []);

      expect(formattedEstimatedSize.value).toContain("5");
      expect(formattedEstimatedSize.value).toContain("GB");
    });
  });

  describe("uses correct library id", () => {
    it("updates when libraryId changes", async () => {
      const libraryId = ref("lib-1");
      const { startDownload } = useDownloadZip(libraryId);

      mocks.fetch.mockResolvedValue({ totalSize: 100, fileCount: 1 });
      mocks.globalFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(["zip"])),
      });

      await startDownload(["file-1"], []);
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/libraries/lib-1/download-estimate",
        expect.any(Object),
      );

      libraryId.value = "lib-2";
      await startDownload(["file-2"], []);
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/libraries/lib-2/download-estimate",
        expect.any(Object),
      );
    });
  });
});
