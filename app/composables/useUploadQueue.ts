import { getMimeTypeFromFilename } from "~/utils/mime-icons";

export interface QueuedFile {
  id: string;
  file: File;
  libraryId: string;
  libraryName: string;
  parentFolderId: string | null;
  status: "pending" | "uploading" | "error" | "done";
  progress: number;
  loaded: number;
  total: number;
  error?: string;
  retries: number;
}

const MAX_RETRIES = 3;
const CONCURRENCY = 3;
const STALL_TIMEOUT_MS = 30_000;
const DONE_CLEANUP_MS = 2_000;

const onCompleteCallbacks = new Map<string, () => void>();

export function useUploadQueue() {
  const queue = useState<QueuedFile[]>("upload-queue", () => []);
  const isProcessing = useState<boolean>("upload-processing", () => false);
  const uploadSpeed = useState<number>("upload-speed", () => 0);

  // Track active upload count and per-file abort controllers
  const activeCount = useState<number>("upload-active-count", () => 0);
  const abortControllers = new Map<string, AbortController>();

  // Speed tracking across all concurrent uploads
  let speedBytes = 0;
  let speedTimer: ReturnType<typeof setInterval> | null = null;

  function startSpeedTracker() {
    if (speedTimer) return;
    speedBytes = 0;
    speedTimer = setInterval(() => {
      uploadSpeed.value = speedBytes * 2; // interval is 500ms, so *2 for per-second rate
      speedBytes = 0;
    }, 500);
  }

  function stopSpeedTracker() {
    if (speedTimer) {
      clearInterval(speedTimer);
      speedTimer = null;
    }
    uploadSpeed.value = 0;
    speedBytes = 0;
  }

  function addFiles(
    files: File[],
    libraryId: string,
    libraryName: string,
    parentFolderId: string | null = null,
  ) {
    const newItems: QueuedFile[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      libraryId,
      libraryName,
      parentFolderId,
      status: "pending" as const,
      progress: 0,
      loaded: 0,
      total: file.size,
      retries: 0,
    }));
    queue.value = [...queue.value, ...newItems];
    drainQueue();
  }

  function drainQueue() {
    if (!isProcessing.value) {
      isProcessing.value = true;
      startSpeedTracker();
    }

    while (activeCount.value < CONCURRENCY) {
      const next =
        queue.value.find((f) => f.status === "pending") ||
        queue.value.find((f) => f.status === "error" && f.retries < MAX_RETRIES);
      if (!next) break;

      // Mark uploading before starting the async work to prevent re-picking
      next.status = "uploading";
      next.progress = 0;
      next.loaded = 0;
      activeCount.value++;
      uploadFile(next);
    }

    // Check if everything is done
    if (activeCount.value === 0) {
      isProcessing.value = false;
      stopSpeedTracker();
    }
  }

  function notifyLibraryIfIdle(libraryId: string) {
    const hasInFlightUploads = queue.value.some(
      (file) =>
        file.libraryId === libraryId && (file.status === "pending" || file.status === "uploading"),
    );
    if (hasInFlightUploads) return;

    const cb = onCompleteCallbacks.get(libraryId);
    if (cb) cb();
  }

  function uploadFile(item: QueuedFile): void {
    const xhr = new XMLHttpRequest();
    const abortController = new AbortController();
    abortControllers.set(item.id, abortController);

    let settled = false;
    let lastProgressTime = Date.now();
    let stallCheck: ReturnType<typeof setInterval> | null = null;

    const finish = (cleanup = true) => {
      if (settled) return;
      settled = true;

      if (stallCheck) {
        clearInterval(stallCheck);
        stallCheck = null;
      }
      abortControllers.delete(item.id);

      if (cleanup) {
        activeCount.value--;
      }

      notifyLibraryIfIdle(item.libraryId);

      // Continue draining the queue for the next file
      drainQueue();
    };

    // Stall detection: if no progress event fires for STALL_TIMEOUT_MS, abort
    stallCheck = setInterval(() => {
      if (item.status !== "uploading") {
        if (stallCheck) clearInterval(stallCheck);
        return;
      }
      if (Date.now() - lastProgressTime > STALL_TIMEOUT_MS) {
        xhr.abort();
        // onabort handler will fire and handle cleanup
      }
    }, 5_000);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const prevLoaded = item.loaded;
        item.loaded = e.loaded;
        item.total = e.total;
        item.progress = Math.round((e.loaded / e.total) * 100);
        lastProgressTime = Date.now();

        // Accumulate bytes for speed calculation
        const delta = e.loaded - prevLoaded;
        if (delta > 0) {
          speedBytes += delta;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        item.status = "done";
        item.progress = 100;

        setTimeout(() => {
          queue.value = queue.value.filter((f) => f.id !== item.id);
        }, DONE_CLEANUP_MS);
      } else {
        item.status = "error";
        item.error = `Upload failed (${xhr.status})`;
        item.retries++;
      }
      finish();
    };

    xhr.onerror = () => {
      item.status = "error";
      item.error = "Network error";
      item.retries++;
      finish();
    };

    xhr.onabort = () => {
      item.status = "error";
      item.error = "Upload stalled";
      item.retries++;
      finish();
    };

    xhr.ontimeout = () => {
      item.status = "error";
      item.error = "Upload timed out";
      item.retries++;
      finish();
    };

    // Listen for external abort (from removeFile or page unload)
    abortController.signal.addEventListener("abort", () => {
      xhr.abort();
    });

    const mimeType = getMimeTypeFromFilename(item.file.name);

    const formData = new FormData();
    formData.append("file", item.file);
    formData.append("name", item.file.name);
    formData.append("mimeType", mimeType);
    formData.append("lastModified", String(item.file.lastModified));
    if (item.parentFolderId) {
      formData.append("parentFolderId", item.parentFolderId);
    }

    xhr.open("POST", `/api/libraries/${item.libraryId}/files`);
    xhr.send(formData);
  }

  function retryFile(itemId: string) {
    const item = queue.value.find((f) => f.id === itemId);
    if (item && item.status === "error") {
      item.status = "pending";
      item.retries = 0;
      drainQueue();
    }
  }

  function retryAll() {
    for (const item of queue.value) {
      if (item.status === "error") {
        item.status = "pending";
        item.retries = 0;
      }
    }
    drainQueue();
  }

  function removeFile(itemId: string) {
    // Abort in-flight upload if active
    const controller = abortControllers.get(itemId);
    if (controller) {
      controller.abort();
      abortControllers.delete(itemId);
    }
    queue.value = queue.value.filter((f) => f.id !== itemId);
  }

  function clearErrors() {
    queue.value = queue.value.filter((f) => f.status !== "error");
  }

  function onLibraryUploadComplete(libraryId: string, callback: () => void) {
    onCompleteCallbacks.set(libraryId, callback);
  }

  function removeOnComplete(libraryId: string) {
    onCompleteCallbacks.delete(libraryId);
  }

  const activeUploads = computed(() => queue.value.filter((f) => f.status !== "done"));
  const hasActiveUploads = computed(() => activeUploads.value.length > 0);
  const hasInFlightUploads = computed(() =>
    queue.value.some((f) => f.status === "pending" || f.status === "uploading"),
  );
  const erroredUploads = computed(() => queue.value.filter((f) => f.status === "error"));
  const currentUpload = computed(() => queue.value.find((f) => f.status === "uploading"));

  return {
    queue,
    isProcessing,
    uploadSpeed,
    activeCount,
    activeUploads,
    hasActiveUploads,
    hasInFlightUploads,
    erroredUploads,
    currentUpload,
    addFiles,
    retryFile,
    retryAll,
    removeFile,
    clearErrors,
    onLibraryUploadComplete,
    removeOnComplete,
  };
}
