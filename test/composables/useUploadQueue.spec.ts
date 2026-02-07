import { useUploadQueue } from "~/composables/useUploadQueue";

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  status = 0;
  method = "";
  url = "";
  body: FormData | null = null;

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

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body as FormData;
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
}

async function flushPromises() {
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
    queue.removeOnComplete("lib-1");
    queue.removeOnComplete("lib-2");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads a file successfully, reports progress, invokes completion callback, and cleans up", async () => {
    const now = { value: 0 };
    vi.spyOn(Date, "now").mockImplementation(() => now.value);

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
    expect(xhr.body?.get("name")).toBe("hello.txt");
    expect(xhr.body?.get("mimeType")).toBe("text/plain");
    expect(xhr.body?.get("parentFolderId")).toBe("folder-1");

    now.value = 700;
    xhr.triggerProgress(700, 1000);
    expect(queue.currentUpload.value?.progress).toBe(70);
    expect(queue.uploadSpeed.value).toBe(1000);

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

  it("retries failed uploads up to max retries and then leaves the item in error", async () => {
    const queue = useUploadQueue();
    const file = new File(["payload"], "fail.bin");

    queue.addFiles([file], "lib-1", "Library One");

    MockXMLHttpRequest.instances[0]!.respond(500);
    await flushPromises();
    MockXMLHttpRequest.instances[1]!.respond(500);
    await flushPromises();
    MockXMLHttpRequest.instances[2]!.respond(500);
    await flushPromises();

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

    MockXMLHttpRequest.instances[0]!.fail();
    await flushPromises();
    MockXMLHttpRequest.instances[1]!.fail();
    await flushPromises();
    MockXMLHttpRequest.instances[2]!.fail();
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("error");
    expect(queue.queue.value[0]?.error).toBe("Network error");
    expect(queue.queue.value[0]?.retries).toBe(3);

    const itemId = queue.queue.value[0]!.id;
    queue.retryFile(itemId);
    await flushPromises();

    expect(queue.queue.value[0]?.status).toBe("uploading");
    expect(MockXMLHttpRequest.instances).toHaveLength(4);

    queue.removeFile(itemId);
    expect(queue.queue.value).toHaveLength(0);
    expect(queue.activeUploads.value).toHaveLength(0);
    expect(queue.hasActiveUploads.value).toBe(false);
  });
});
