import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import { formatFileSize } from '$lib/utils/mime-icons';

const MAX_ZIP_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB - must match server

function buildZipDownloadName(): string {
	const utc = new Date()
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z');
	return `alcoves-download-${utc}.zip`;
}

/**
 * ZIP download flow with a size-estimate warning. Ported from the Nuxt
 * `useDownloadZip` composable.
 *
 * The reactive `libraryId` (a `Ref<string>` in Vue) is passed as a getter so the
 * store reads the latest value on every call. The consuming component renders the
 * size-warning modal from `showSizeWarning` and wires its buttons to
 * `confirmLargeDownload` / `cancelLargeDownload`.
 */
export function createDownloadZip(getLibraryId: () => string) {
	let downloading = $state(false);
	let showSizeWarning = $state(false);
	let pendingDownload = $state<{ fileIds: string[]; folderIds: string[] } | null>(null);
	let estimatedSize = $state(0);
	let estimatedFileCount = $state(0);

	const formattedEstimatedSize = $derived(formatFileSize(estimatedSize));

	function estimateSize(fileIds: string[], folderIds: string[]) {
		return api.downloads.estimate(getLibraryId(), { fileIds, folderIds });
	}

	async function startDownload(fileIds: string[], folderIds: string[], skipSizeCheck = false) {
		downloading = true;
		try {
			if (!skipSizeCheck) {
				const estimate = await estimateSize(fileIds, folderIds);

				if (estimate.fileCount === 0) {
					toast.add({ title: 'No files to download', color: 'warning' });
					return;
				}

				if (estimate.totalSize > MAX_ZIP_SIZE_BYTES) {
					estimatedSize = estimate.totalSize;
					estimatedFileCount = estimate.fileCount;
					pendingDownload = { fileIds, folderIds };
					showSizeWarning = true;
					return;
				}
			}

			const response = await fetch(api.downloads.url(getLibraryId()), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileIds, folderIds, skipSizeCheck }),
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json().catch(() => null);
				if (response.status === 413 && error?.data) {
					estimatedSize = error.data.totalSize;
					estimatedFileCount = error.data.fileCount;
					pendingDownload = { fileIds, folderIds };
					showSizeWarning = true;
					return;
				}
				throw new Error(error?.statusMessage || 'Download failed');
			}

			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = buildZipDownloadName();
			link.click();
			URL.revokeObjectURL(url);

			toast.add({ title: 'Download started' });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : 'Download failed';
			toast.add({ title: message, color: 'error' });
		} finally {
			downloading = false;
		}
	}

	async function confirmLargeDownload() {
		if (!pendingDownload) return;
		const { fileIds, folderIds } = pendingDownload;
		showSizeWarning = false;
		pendingDownload = null;
		await startDownload(fileIds, folderIds, true);
	}

	function cancelLargeDownload() {
		showSizeWarning = false;
		pendingDownload = null;
		estimatedSize = 0;
		estimatedFileCount = 0;
	}

	return {
		get downloading() {
			return downloading;
		},
		get showSizeWarning() {
			return showSizeWarning;
		},
		get estimatedSize() {
			return estimatedSize;
		},
		get estimatedFileCount() {
			return estimatedFileCount;
		},
		get formattedEstimatedSize() {
			return formattedEstimatedSize;
		},
		startDownload,
		confirmLargeDownload,
		cancelLargeDownload
	};
}
