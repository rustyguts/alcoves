import type { Ref, ComputedRef } from "vue";
import { formatFileSize } from "~/utils/mime-icons";
import { apiFetch } from "~/utils/api-fetch";

const MAX_ZIP_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB - must match server

interface DownloadEstimate {
  totalSize: number;
  fileCount: number;
}

export function useDownloadZip(libraryId: Ref<string> | ComputedRef<string>) {
  const toast = useToast();
  const downloading = ref(false);
  const showSizeWarning = ref(false);
  const pendingDownload = ref<{ fileIds: string[]; folderIds: string[] } | null>(null);
  const estimatedSize = ref(0);
  const estimatedFileCount = ref(0);

  async function estimateSize(fileIds: string[], folderIds: string[]): Promise<DownloadEstimate> {
    return apiFetch<DownloadEstimate>(`/api/libraries/${libraryId.value}/download-estimate`, {
      method: "POST",
      body: { fileIds, folderIds },
    });
  }

  async function startDownload(fileIds: string[], folderIds: string[], skipSizeCheck = false) {
    downloading.value = true;
    try {
      if (!skipSizeCheck) {
        const estimate = await estimateSize(fileIds, folderIds);

        if (estimate.fileCount === 0) {
          toast.add({ title: "No files to download", color: "warning" });
          return;
        }

        if (estimate.totalSize > MAX_ZIP_SIZE_BYTES) {
          estimatedSize.value = estimate.totalSize;
          estimatedFileCount.value = estimate.fileCount;
          pendingDownload.value = { fileIds, folderIds };
          showSizeWarning.value = true;
          return;
        }
      }

      const response = await fetch(`/api/libraries/${libraryId.value}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds, folderIds, skipSizeCheck }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (response.status === 413 && error?.data) {
          estimatedSize.value = error.data.totalSize;
          estimatedFileCount.value = error.data.fileCount;
          pendingDownload.value = { fileIds, folderIds };
          showSizeWarning.value = true;
          return;
        }
        throw new Error(error?.statusMessage || "Download failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "download.zip";
      link.click();
      URL.revokeObjectURL(url);

      toast.add({ title: "Download started" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Download failed";
      toast.add({ title: message, color: "error" });
    } finally {
      downloading.value = false;
    }
  }

  async function confirmLargeDownload() {
    if (!pendingDownload.value) return;
    const { fileIds, folderIds } = pendingDownload.value;
    showSizeWarning.value = false;
    pendingDownload.value = null;
    await startDownload(fileIds, folderIds, true);
  }

  function cancelLargeDownload() {
    showSizeWarning.value = false;
    pendingDownload.value = null;
    estimatedSize.value = 0;
    estimatedFileCount.value = 0;
  }

  const formattedEstimatedSize = computed(() => formatFileSize(estimatedSize.value));

  return {
    downloading,
    showSizeWarning,
    estimatedSize,
    estimatedFileCount,
    formattedEstimatedSize,
    startDownload,
    confirmLargeDownload,
    cancelLargeDownload,
  };
}
