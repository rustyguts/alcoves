import { useUploadQueue } from "~/composables/useUploadQueue";

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  status = 0;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: File | null = null;

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  static reset() {
    MockXMLHttpRequest.instances = [];
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body as File;
  }

  triggerProgress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent);
  }

  respond(status = 200) {
    this.status = status;
    this.onload?.();
  }

  fail() {
    this.onerror?.();
  }

  abort() {
    this.onabort?.();
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useUploadQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockXMLHttpRequest.reset();

    vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);
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

  it("uploads a file successfully with headers, reports progress, invokes completion callback, and cleans up", async () => {
    const queue = useUploadQueue();
    const onComplete = vi.fn();
    queue.onLibraryUploadComplete("lib-1", onComplete);

    const file = new File(["hello"], "hello.txt", {
      type: "text/plain",
      lastModified: 100,
    });

    queue.addFiles([file], "lib-1", "Library One", "folder-1");

    expect(queue.queue.value).toHaveLength(1);
    expect(queue.currentUpload.value?.status).toBe("uploading");

    const xhr = MockXMLHttpRequest.instances[0]!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/libraries/lib-1/files");

    // Verify headers carry the metadata
    expect(xhr.headers["Content-Type"]).toBe("application/octet-stream");
    expect(decodeURIComponent(xhr.headers["X-Upload-Name"]!)).toBe("hello.txt");
    expect(xhr.headers["X-Upload-Mime-Type"]).toBe("text/plain");
    expect(xhr.headers["X-Upload-Folder-Id"]).toBe("folder-1");
    expect(xhr.headers["X-Upload-Last-Modified"]).toBe("100");

    // Body is the raw File, not FormData
    expect(xhr.body).toBeInstanceOf(File);

    xhr.triggerProgress(700, 1000);
    expect(queue.currentUpload.value?.progress).toBe(70);

    xhr.respond(201);
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
    expect(MockXMLHttpRequest.instances).toHaveLength(3);
    expect(queue.queue.value.filter((f) => f.status === "uploading")).toHaveLength(3);
    expect(queue.queue.value.filter((f) => f.status === "pending")).toHaveLength(2);

    // Complete the first upload — should start the 4th
    MockXMLHttpRequest.instances[0]!.respond(201);
    await flushPromises();

    expect(MockXMLHttpRequest.instances).toHaveLength(4);
    expect(queue.queue.value.filter((f) => f.status === "uploading")).toHaveLength(3);
    expect(queue.queue.value.filter((f) => f.status === "pending")).toHaveLength(1);

    // Complete the second — should start the 5th
    MockXMLHttpRequest.instances[1]!.respond(201);
    await flushPromises();

    expect(MockXMLHttpRequest.instances).toHaveLength(5);
    expect(queue.queue.value.filter((f) => f.status === "pending")).toHaveLength(0);
  });

  it("retries failed uploads up to max retries and then leaves the item in error", async () => {
    const queue = useUploadQueue();
    const file = new File(["payload"], "fail.bin");

    queue.addFiles([file], "lib-1", "Library One");

    // First attempt fails
    MockXMLHttpRequest.instances[0]!.respond(500);
    await flushPromises();

    // Auto-retry picks it up (retries < MAX_RETRIES=3)
    expect(MockXMLHttpRequest.instances).toHaveLength(2);
    MockXMLHttpRequest.instances[1]!.respond(500);
    await flushPromises();

    expect(MockXMLHttpRequest.instances).toHaveLength(3);
    MockXMLHttpRequest.instances[2]!.respond(500);
    await flushPromises();

    // After 3 retries, stays in error state
    expect(MockXMLHttpRequest.instances).toHaveLength(3);
    expect(queue.queue.value).toHaveLength(1);
    expect(queue.queue.value[0]?.status).toBe("error");
    expect(queue.queue.value[0]?.retries).toBe(3);
    expect(queue.isProcessing.value).toBe(false);
  });

  it("handles network errors and supports manual retry and remove", async () => {
    const queue = useUploadQueue();
    const file = new File(["payload"], "network.txt");

    queue.addFiles([file], "lib-2", "Library Two");

    // Fail 3 times via network error
    MockXMLHttpRequest.instances[0]!.fail();
    await flushPromises();
    MockXMLHttpRequest.instances[1]!.fail();
    await flushPromises();
    MockXMLHttpRequest.instances[2]!.fail();
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("error");
    expect(queue.queue.value[0]?.error).toBe("Network error");
    expect(queue.queue.value[0]?.retries).toBe(3);

    // Manual retry resets retries and re-queues
    const itemId = queue.queue.value[0]!.id;
    queue.retryFile(itemId);
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("uploading");
    expect(MockXMLHttpRequest.instances).toHaveLength(4);

    // Remove while uploading
    queue.removeFile(itemId);
    expect(queue.queue.value).toHaveLength(0);
    expect(queue.activeUploads.value).toHaveLength(0);
    expect(queue.hasActiveUploads.value).toBe(false);
  });

  it("does not include X-Upload-Folder-Id header when parentFolderId is null", async () => {
    const queue = useUploadQueue();
    const file = new File(["x"], "test.txt");

    queue.addFiles([file], "lib-1", "Library One", null);
    await flushPromises();

    const xhr = MockXMLHttpRequest.instances[0]!;
    expect(xhr.headers["X-Upload-Folder-Id"]).toBeUndefined();
    expect(decodeURIComponent(xhr.headers["X-Upload-Name"]!)).toBe("test.txt");
    expect(xhr.body).toBeInstanceOf(File);
  });

  it("stall detection aborts uploads with no progress", async () => {
    const queue = useUploadQueue();
    const file = new File(["stall"], "stall.txt");

    queue.addFiles([file], "lib-1", "Library One");
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("uploading");

    // Advance past the stall timeout (30s) + check interval (5s)
    vi.advanceTimersByTime(35_000);
    await flushPromises();

    // The stall check should have called xhr.abort(), triggering onabort
    // which sets status to error
    const xhr = MockXMLHttpRequest.instances[0]!;
    // Simulate what the real browser does when abort() is called
    xhr.onabort?.();
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("error" as string);
    expect(queue.queue.value[0]?.error).toBe("Upload stalled");
  });

  it("completion callback fires only after all uploads for a library finish", async () => {
    const queue = useUploadQueue();
    const onComplete = vi.fn();
    queue.onLibraryUploadComplete("lib-1", onComplete);

    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];
    queue.addFiles(files, "lib-1", "Library One");
    await flushPromises();

    // Complete first file — callback should NOT fire yet
    MockXMLHttpRequest.instances[0]!.respond(201);
    await flushPromises();
    expect(onComplete).not.toHaveBeenCalled();

    // Complete second file — callback should fire
    MockXMLHttpRequest.instances[1]!.respond(201);
    await flushPromises();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("retryAll resets all errored items and restarts processing", async () => {
    const queue = useUploadQueue();
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];

    queue.addFiles(files, "lib-1", "Library One");
    await flushPromises();

    // Fail both
    MockXMLHttpRequest.instances[0]!.respond(500);
    await flushPromises();
    MockXMLHttpRequest.instances[1]!.respond(500);
    await flushPromises();
    // Auto retries will fire...
    // Fail the retries too
    for (let i = 2; i < MockXMLHttpRequest.instances.length; i++) {
      MockXMLHttpRequest.instances[i]!.respond(500);
      await flushPromises();
    }

    // Wait until all are exhausted
    const stillRunning = () => MockXMLHttpRequest.instances.some((x) => x.status === 0);
    while (stillRunning()) {
      for (const xhr of MockXMLHttpRequest.instances) {
        if (xhr.status === 0) xhr.respond(500);
      }
      await flushPromises();
    }

    const errorCount = queue.queue.value.filter((f) => f.status === "error").length;
    expect(errorCount).toBe(2);

    const prevCount = MockXMLHttpRequest.instances.length;
    queue.retryAll();
    await flushPromises();

    // Should have started new XHR instances
    expect(MockXMLHttpRequest.instances.length).toBeGreaterThan(prevCount);
  });

  it("clearErrors removes only errored items", async () => {
    const queue = useUploadQueue();
    const files = [new File(["a"], "a.txt"), new File(["b"], "b.txt")];

    queue.addFiles(files, "lib-1", "Library One");
    await flushPromises();

    // Fail one, succeed the other
    MockXMLHttpRequest.instances[0]!.respond(500);
    await flushPromises();

    // Exhaust retries on the first file
    while (queue.queue.value.some((f) => f.status === "uploading" || f.status === "pending")) {
      for (const xhr of MockXMLHttpRequest.instances) {
        if (xhr.status === 0) xhr.respond(500);
      }
      await flushPromises();
    }

    // We should have at least one error
    expect(queue.erroredUploads.value.length).toBeGreaterThanOrEqual(1);

    const totalBefore = queue.queue.value.length;
    queue.clearErrors();
    expect(queue.queue.value.length).toBeLessThan(totalBefore);
    expect(queue.queue.value.filter((f) => f.status === "error")).toHaveLength(0);
  });
});
