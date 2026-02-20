import { ref, computed } from "vue";
import * as tus from "tus-js-client";
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
const DONE_CLEANUP_MS = 2_000;

const TUS_ENDPOINT = "/api/tus";

const onCompleteCallbacks = new Map<string, () => void>();
const onSuccessCallbacks = new Map<string, () => void>();

const queue = ref<QueuedFile[]>([]);
const isProcessing = ref(false);
const uploadSpeed = ref(0);
const activeCount = ref(0);

export function useUploadQueue() {
  const tusUploads = new Map<string, tus.Upload>();

  let speedBytes = 0;
  let speedTimer: ReturnType<typeof setInterval> | null = null;

  function startSpeedTracker() {
    if (speedTimer) return;
    speedBytes = 0;
    speedTimer = setInterval(() => {
      uploadSpeed.value = speedBytes * 2;
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

      next.status = "uploading";
      next.progress = 0;
      next.loaded = 0;
      activeCount.value++;
      uploadFile(next);
    }

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

  function notifyLibraryUploadSuccess(libraryId: string) {
    const cb = onSuccessCallbacks.get(libraryId);
    if (cb) cb();
  }

  function uploadFile(item: QueuedFile): void {
    const mimeType = getMimeTypeFromFilename(item.file.name);

    const metadata: Record<string, string> = {
      libraryId: item.libraryId,
      filename: item.file.name,
      mimeType,
      lastModified: String(item.file.lastModified),
    };
    if (item.parentFolderId) {
      metadata.folderId = item.parentFolderId;
    }

    const upload = new tus.Upload(item.file, {
      endpoint: TUS_ENDPOINT,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: 50 * 1024 * 1024,
      metadata,

      onShouldRetry(err, _retryAttempt, _options) {
        const status = (err as tus.DetailedError).originalResponse?.getStatus();
        if (status === 401 || status === 403 || status === 404 || status === 413) {
          return false;
        }
        return true;
      },

      onChunkComplete(_chunkSize, bytesAccepted, bytesTotal) {
        item.loaded = bytesAccepted;
        item.total = bytesTotal;
        item.progress = Math.round((bytesAccepted / bytesTotal) * 100);
      },

      onProgress(bytesUploaded, bytesTotal) {
        const optimistic = Math.round((bytesUploaded / bytesTotal) * 100);
        if (optimistic > item.progress) {
          item.progress = optimistic;
        }
        item.total = bytesTotal;

        const prevLoaded = item.loaded;
        const delta = bytesUploaded - prevLoaded;
        if (delta > 0) {
          speedBytes += delta;
        }
      },

      onSuccess() {
        item.status = "done";
        item.progress = 100;
        tusUploads.delete(item.id);

        notifyLibraryUploadSuccess(item.libraryId);

        setTimeout(() => {
          queue.value = queue.value.filter((f) => f.id !== item.id);
        }, DONE_CLEANUP_MS);

        finish(item);
      },

      onError(error) {
        item.status = "error";
        item.error = error.message || "Upload failed";
        item.retries++;
        tusUploads.delete(item.id);
        finish(item);
      },
    });

    tusUploads.set(item.id, upload);

    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0 && previousUploads[0]) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    });
  }

  function finish(item: QueuedFile) {
    activeCount.value--;
    notifyLibraryIfIdle(item.libraryId);
    drainQueue();
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
    const upload = tusUploads.get(itemId);
    if (upload) {
      upload.abort(false);
      tusUploads.delete(itemId);
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

  function onLibraryUploadSuccess(libraryId: string, callback: () => void) {
    onSuccessCallbacks.set(libraryId, callback);
  }

  function removeOnSuccess(libraryId: string) {
    onSuccessCallbacks.delete(libraryId);
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
    onLibraryUploadSuccess,
    removeOnSuccess,
  };
}
