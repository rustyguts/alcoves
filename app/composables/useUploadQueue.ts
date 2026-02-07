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

const onCompleteCallbacks = new Map<string, () => void>();

export function useUploadQueue() {
  const queue = useState<QueuedFile[]>("upload-queue", () => []);
  const isProcessing = useState<boolean>("upload-processing", () => false);
  const uploadSpeed = useState<number>("upload-speed", () => 0);

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
    processQueue();
  }

  async function processQueue() {
    if (isProcessing.value) return;
    isProcessing.value = true;

    while (true) {
      const next = queue.value.find(
        (f) => f.status === "pending" || (f.status === "error" && f.retries < MAX_RETRIES),
      );
      if (!next) break;
      await uploadFile(next);
    }

    uploadSpeed.value = 0;
    isProcessing.value = false;
  }

  function uploadFile(item: QueuedFile): Promise<void> {
    return new Promise((resolve) => {
      item.status = "uploading";
      item.progress = 0;
      item.loaded = 0;

      const formData = new FormData();
      formData.append("file", item.file);
      formData.append("name", item.file.name);
      formData.append("mimeType", getMimeTypeFromFilename(item.file.name));
      formData.append("originalCreatedAt", String(item.file.lastModified));
      if (item.parentFolderId) {
        formData.append("parentFolderId", item.parentFolderId);
      }

      const xhr = new XMLHttpRequest();

      let lastLoaded = 0;
      let lastTime = Date.now();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          item.loaded = e.loaded;
          item.total = e.total;
          item.progress = Math.round((e.loaded / e.total) * 100);

          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          if (elapsed > 0.5) {
            uploadSpeed.value = Math.round((e.loaded - lastLoaded) / elapsed);
            lastLoaded = e.loaded;
            lastTime = now;
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          item.status = "done";
          item.progress = 100;

          const cb = onCompleteCallbacks.get(item.libraryId);
          if (cb) cb();

          setTimeout(() => {
            queue.value = queue.value.filter((f) => f.id !== item.id);
          }, 2000);
        } else {
          item.status = "error";
          item.error = `Upload failed (${xhr.status})`;
          item.retries++;
        }
        resolve();
      };

      xhr.onerror = () => {
        item.status = "error";
        item.error = "Network error";
        item.retries++;
        resolve();
      };

      xhr.open("POST", `/api/libraries/${item.libraryId}/files`);
      xhr.send(formData);
    });
  }

  function retryFile(itemId: string) {
    const item = queue.value.find((f) => f.id === itemId);
    if (item && item.status === "error") {
      item.status = "pending";
      processQueue();
    }
  }

  function removeFile(itemId: string) {
    queue.value = queue.value.filter((f) => f.id !== itemId);
  }

  function onLibraryUploadComplete(libraryId: string, callback: () => void) {
    onCompleteCallbacks.set(libraryId, callback);
  }

  function removeOnComplete(libraryId: string) {
    onCompleteCallbacks.delete(libraryId);
  }

  const activeUploads = computed(() => queue.value.filter((f) => f.status !== "done"));
  const hasActiveUploads = computed(() => activeUploads.value.length > 0);
  const currentUpload = computed(() => queue.value.find((f) => f.status === "uploading"));

  return {
    queue,
    isProcessing,
    uploadSpeed,
    activeUploads,
    hasActiveUploads,
    currentUpload,
    addFiles,
    retryFile,
    removeFile,
    onLibraryUploadComplete,
    removeOnComplete,
  };
}
