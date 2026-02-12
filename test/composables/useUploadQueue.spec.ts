import { useUploadQueue } from "~/composables/useUploadQueue";
import type { UploadOptions, PreviousUpload, OnSuccessPayload } from "tus-js-client";

/**
 * Mock tus.Upload so we never call real tus endpoints.
 *
 * Each constructed Upload is captured in `MockTusUpload.instances`.
 * Tests can simulate progress, success, and error by calling the
 * corresponding option callbacks stored on each instance.
 */
class MockTusUpload {
  static instances: MockTusUpload[] = [];

  file: File;
  options: UploadOptions;
  url: string | null = null;
  started = false;
  aborted = false;

  constructor(file: File, options: UploadOptions) {
    this.file = file;
    this.options = options;
    MockTusUpload.instances.push(this);
  }

  static reset() {
    MockTusUpload.instances = [];
  }

  findPreviousUploads(): Promise<PreviousUpload[]> {
    return Promise.resolve([]);
  }

  resumeFromPreviousUpload(_: PreviousUpload) {
    // no-op
  }

  start() {
    this.started = true;
  }

  abort() {
    this.aborted = true;
    return Promise.resolve();
  }

  triggerProgress(loaded: number, total: number) {
    this.options.onProgress?.(loaded, total);
  }

  triggerSuccess() {
    this.options.onSuccess?.({ lastResponse: null } as unknown as OnSuccessPayload);
  }

  triggerError(message = "Upload failed") {
    const err = new Error(message);
    err.name = "DetailedError";
    this.options.onError?.(err);
  }
}

// Mock the entire tus-js-client module, replacing Upload with our mock class
vi.mock("tus-js-client", () => ({
  Upload: MockTusUpload,
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useUploadQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockTusUpload.reset();

    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockImplementation(() => `id-${Math.random().toString(16).slice(2)}`),
    });

    const queue = useUploadQueue();
    queue.queue.value = [];
    queue.isProcessing.value = false;
    queue.uploadSpeed.value = 0;
    queue.activeCount.value = 0;
    queue.removeOnComplete("lib-1");
    queue.removeOnComplete("lib-2");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads a file successfully with tus metadata, reports progress, invokes completion callback, and cleans up", async () => {
    const queue = useUploadQueue();
    const onComplete = vi.fn();
    queue.onLibraryUploadComplete("lib-1", onComplete);

    const file = new File(["hello"], "hello.txt", {
      type: "text/plain",
      lastModified: 100,
    });

    queue.addFiles([file], "lib-1", "Library One", "folder-1");
    await flushPromises();

    expect(queue.queue.value).toHaveLength(1);
    expect(queue.currentUpload.value?.status).toBe("uploading");

    const tusUpload = MockTusUpload.instances[0]!;
    expect(tusUpload.started).toBe(true);

    // Verify tus metadata
    expect(tusUpload.options.metadata?.libraryId).toBe("lib-1");
    expect(tusUpload.options.metadata?.filename).toBe("hello.txt");
    expect(tusUpload.options.metadata?.mimeType).toBe("text/plain");
    expect(tusUpload.options.metadata?.folderId).toBe("folder-1");
    expect(tusUpload.options.metadata?.lastModified).toBe("100");
    expect(tusUpload.options.endpoint).toBe("/api/tus");

    tusUpload.triggerProgress(700, 1000);
    expect(queue.currentUpload.value?.progress).toBe(70);

    tusUpload.triggerSuccess();
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("done");
    expect(queue.queue.value[0]?.progress).toBe(100);
    expect(onComplete).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    await flushPromises();

    expect(queue.queue.value).toHaveLength(0);
    expect(queue.hasInFlightUploads.value).toBe(false);
  });

  it("uploads multiple files concurrently (up to 3)", async () => {
    const queue = useUploadQueue();

    const files = Array.from({ length: 5 }, (_, i) => new File([`data${i}`], `file${i}.txt`));

    queue.addFiles(files, "lib-1", "Library One");
    await flushPromises();

    // Should have started 3 concurrent uploads
    expect(MockTusUpload.instances).toHaveLength(3);
    expect(queue.queue.value.filter((f) => f.status === "uploading")).toHaveLength(3);
    expect(queue.queue.value.filter((f) => f.status === "pending")).toHaveLength(2);

    // Complete the first upload — should start the 4th
    MockTusUpload.instances[0]!.triggerSuccess();
    await flushPromises();

    expect(MockTusUpload.instances).toHaveLength(4);
    expect(queue.queue.value.filter((f) => f.status === "uploading")).toHaveLength(3);
    expect(queue.queue.value.filter((f) => f.status === "pending")).toHaveLength(1);

    // Complete the second — should start the 5th
    MockTusUpload.instances[1]!.triggerSuccess();
    await flushPromises();

    expect(MockTusUpload.instances).toHaveLength(5);
    expect(queue.queue.value.filter((f) => f.status === "pending")).toHaveLength(0);
  });

  it("retries failed uploads up to max retries and then leaves the item in error", async () => {
    const queue = useUploadQueue();
    const file = new File(["payload"], "fail.bin");

    queue.addFiles([file], "lib-1", "Library One");
    await flushPromises();

    // First attempt fails
    MockTusUpload.instances[0]!.triggerError("Server error");
    await flushPromises();

    // Auto-retry picks it up (retries < MAX_RETRIES=3)
    expect(MockTusUpload.instances).toHaveLength(2);
    MockTusUpload.instances[1]!.triggerError("Server error");
    await flushPromises();

    expect(MockTusUpload.instances).toHaveLength(3);
    MockTusUpload.instances[2]!.triggerError("Server error");
    await flushPromises();

    // After 3 retries, stays in error state
    expect(MockTusUpload.instances).toHaveLength(3);
    expect(queue.queue.value).toHaveLength(1);
    expect(queue.queue.value[0]?.status).toBe("error");
    expect(queue.queue.value[0]?.retries).toBe(3);
    expect(queue.isProcessing.value).toBe(false);
  });

  it("handles errors and supports manual retry and remove", async () => {
    const queue = useUploadQueue();
    const file = new File(["payload"], "network.txt");

    queue.addFiles([file], "lib-2", "Library Two");
    await flushPromises();

    // Fail 3 times
    MockTusUpload.instances[0]!.triggerError("Network error");
    await flushPromises();
    MockTusUpload.instances[1]!.triggerError("Network error");
    await flushPromises();
    MockTusUpload.instances[2]!.triggerError("Network error");
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("error");
    expect(queue.queue.value[0]?.error).toBe("Network error");
    expect(queue.queue.value[0]?.retries).toBe(3);

    // Manual retry resets retries and re-queues
    const itemId = queue.queue.value[0]!.id;
    queue.retryFile(itemId);
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("uploading");
    expect(MockTusUpload.instances).toHaveLength(4);

    // Remove while uploading
    queue.removeFile(itemId);
    expect(queue.queue.value).toHaveLength(0);
    expect(queue.activeUploads.value).toHaveLength(0);
    expect(queue.hasActiveUploads.value).toBe(false);
  });

  it("does not include folderId in metadata when parentFolderId is null", async () => {
    const queue = useUploadQueue();
    const file = new File(["x"], "test.txt");

    queue.addFiles([file], "lib-1", "Library One", null);
    await flushPromises();

    const tusUpload = MockTusUpload.instances[0]!;
    expect(tusUpload.options.metadata?.folderId).toBeUndefined();
    expect(tusUpload.options.metadata?.filename).toBe("test.txt");
  });

  it("completion callback fires only after all uploads for a library finish", async () => {
    const queue = useUploadQueue();
    const onComplete = vi.fn();
    queue.onLibraryUploadComplete("lib-1", onComplete);

    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];
    queue.addFiles(files, "lib-1", "Library One");
    await flushPromises();

    // Complete first file — callback should NOT fire yet
    MockTusUpload.instances[0]!.triggerSuccess();
    await flushPromises();
    expect(onComplete).not.toHaveBeenCalled();

    // Complete second file — callback should fire
    MockTusUpload.instances[1]!.triggerSuccess();
    await flushPromises();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("retryAll resets all errored items and restarts processing", async () => {
    const queue = useUploadQueue();
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];

    queue.addFiles(files, "lib-1", "Library One");
    await flushPromises();

    // Fail both — exhaust all retries
    for (let i = 0; i < MockTusUpload.instances.length; i++) {
      MockTusUpload.instances[i]!.triggerError("fail");
      await flushPromises();
    }

    // Keep failing retries until exhausted
    while (queue.queue.value.some((f) => f.status === "uploading")) {
      for (const inst of MockTusUpload.instances) {
        if (inst.started && !inst.aborted) inst.triggerError("fail");
      }
      await flushPromises();
    }

    const errorCount = queue.queue.value.filter((f) => f.status === "error").length;
    expect(errorCount).toBe(2);

    const prevCount = MockTusUpload.instances.length;
    queue.retryAll();
    await flushPromises();

    // Should have started new tus Upload instances
    expect(MockTusUpload.instances.length).toBeGreaterThan(prevCount);
  });

  it("clearErrors removes only errored items", async () => {
    const queue = useUploadQueue();
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];

    queue.addFiles(files, "lib-1", "Library One");
    await flushPromises();

    // Fail one, exhaust retries
    MockTusUpload.instances[0]!.triggerError("fail");
    await flushPromises();

    while (queue.queue.value.some((f) => f.status === "uploading" || f.status === "pending")) {
      for (const inst of MockTusUpload.instances) {
        if (inst.started && !inst.aborted) inst.triggerError("fail");
      }
      await flushPromises();
    }

    expect(queue.erroredUploads.value.length).toBeGreaterThanOrEqual(1);

    const totalBefore = queue.queue.value.length;
    queue.clearErrors();
    expect(queue.queue.value.length).toBeLessThan(totalBefore);
    expect(queue.queue.value.filter((f) => f.status === "error")).toHaveLength(0);
  });
});
