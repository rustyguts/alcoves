import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("tus-js-client", () => ({
  Upload: class {
    start() {}
    abort() {}
    findPreviousUploads() {
      return Promise.resolve([]);
    }
  },
}));
vi.mock("~/composables/useToast", () => ({ useToast: () => ({ add: vi.fn() }) }));

import { useUploadQueue, type QueuedFile } from "~/composables/useUploadQueue";

function queued(over: Partial<QueuedFile> & { id: string; status: QueuedFile["status"] }): QueuedFile {
  return {
    file: new File(["x"], "f"),
    libraryId: "lib1",
    libraryName: "L",
    parentFolderId: null,
    progress: 0,
    loaded: 0,
    total: 1,
    retries: 0,
    ...over,
  } as QueuedFile;
}

afterEach(() => {
  useUploadQueue().queue.value = [];
});

describe("useUploadQueue callbacks + computeds", () => {
  it("registers and removes per-library complete/success callbacks", () => {
    const q = useUploadQueue();
    expect(() => {
      q.onLibraryUploadComplete("lib1", () => {});
      q.removeOnComplete("lib1");
      q.onLibraryUploadSuccess("lib1", () => {});
      q.removeOnSuccess("lib1");
    }).not.toThrow();
  });

  it("derives active / in-flight / errored / current uploads from the queue", () => {
    const q = useUploadQueue();
    q.queue.value = [
      queued({ id: "1", status: "uploading" }),
      queued({ id: "2", status: "error" }),
      queued({ id: "3", status: "done" }),
      queued({ id: "4", status: "pending" }),
    ];
    expect(q.hasActiveUploads.value).toBe(true);
    expect(q.hasInFlightUploads.value).toBe(true);
    expect(q.currentUpload.value?.id).toBe("1");
    expect(q.erroredUploads.value.map((f) => f.id)).toEqual(["2"]);
    expect(q.activeUploads.value.map((f) => f.id)).toEqual(["1", "2", "4"]);
  });

  it("reports no in-flight uploads when everything is done", () => {
    const q = useUploadQueue();
    q.queue.value = [queued({ id: "1", status: "done" })];
    expect(q.hasInFlightUploads.value).toBe(false);
    expect(q.currentUpload.value).toBeUndefined();
  });
});
