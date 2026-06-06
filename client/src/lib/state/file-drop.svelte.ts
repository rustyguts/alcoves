/**
 * Builds a Set of filenames that correspond to directories.
 *
 * Uses the non-standard `webkitGetAsEntry()` API (supported by Chrome, Edge,
 * Firefox, and Safari) to detect directory entries. Falls back gracefully when
 * the API is unavailable — returning an empty Set so that no files are
 * incorrectly filtered out.
 */
function getDirectoryNames(dataTransfer: DataTransfer): Set<string> {
	// Transient local set (not reactive state); SvelteSet is unnecessary here.

	const dirs = new Set<string>();
	const items = dataTransfer.items;
	if (!items) return dirs;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (!item || item.kind !== 'file') continue;

		const entry = (
			item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }
		).webkitGetAsEntry?.();
		if (entry?.isDirectory) {
			// Store the name so we can exclude matching File objects from the files list.
			dirs.add(entry.name);
		}
	}

	return dirs;
}

/**
 * Extracts files from a drop event in a cross-browser-safe way.
 *
 * Strategy:
 * 1. Use `dataTransfer.files` (FileList) as the **primary** source of File
 *    objects. This is universally supported and always returns real File
 *    objects with correct size, type, and content.
 * 2. Use `dataTransfer.items` + `webkitGetAsEntry()` **only** to identify
 *    directories so they can be excluded.
 *
 * Previous approaches that iterated `dataTransfer.items` and called
 * `getAsFile()` first could yield zero-size File objects on some browser/OS
 * combinations (notably Safari on macOS and some Chromium builds on Linux)
 * because the underlying data transfer can be consumed or invalidated after
 * certain API calls.
 */
export function extractDroppedFiles(dataTransfer: DataTransfer): File[] {
	const directoryNames = getDirectoryNames(dataTransfer);

	const files: File[] = [];
	const fileList = dataTransfer.files;
	for (let i = 0; i < fileList.length; i++) {
		const file = fileList[i];
		if (!file) continue;

		// Skip directories. On most browsers a directory entry appears in
		// `dataTransfer.files` as a File with size 0 and an empty type. We
		// double-check against the directory names collected from
		// `webkitGetAsEntry()` to avoid false positives with legitimately
		// empty files.
		if (directoryNames.has(file.name)) continue;

		files.push(file);
	}

	return files;
}

/**
 * Returns `true` when the drag event carries files from the operating system
 * (as opposed to internal drag-and-drop of DOM elements).
 */
export function hasFilePayload(event: DragEvent): boolean {
	const types = event.dataTransfer?.types;
	if (!types) return false;
	// `types` is a DOMStringList in some browsers, an array in others.
	for (let i = 0; i < types.length; i++) {
		if (types[i] === 'Files') return true;
	}
	return false;
}

export interface FileDropOptions {
	/** Called with the extracted files when the user completes a drop. */
	onDrop: (files: File[]) => void;
}

/**
 * Rune store that provides drag-and-drop file upload event handlers and
 * reactive state.
 *
 * Ported from the Nuxt `useFileDrop` composable. The reactive `enabled` ref
 * becomes a getter function (`getEnabled`) the consumer passes in; when it
 * returns `false`, all drag/drop events are ignored. Reactive state
 * (`isOverDropZone`, `dragDepth`) is exposed through getters so reactivity
 * survives the function boundary.
 *
 * Usage:
 * ```svelte
 * <div {...drop.dropZoneProps}>
 *   {#if drop.isOverDropZone}
 *     <div class="overlay">Drop files here</div>
 *   {/if}
 *   <!-- content -->
 * </div>
 * ```
 */
export function createFileDrop(options: FileDropOptions, getEnabled: () => boolean = () => true) {
	let isOverDropZone = $state(false);
	let dragDepth = $state(0);

	function handleDragEnter(event: DragEvent) {
		if (!getEnabled() || !hasFilePayload(event)) return;
		event.preventDefault();
		dragDepth += 1;
		isOverDropZone = true;
	}

	function handleDragOver(event: DragEvent) {
		if (!getEnabled() || !hasFilePayload(event)) return;
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	}

	function handleDragLeave(event: DragEvent) {
		if (!getEnabled() || !hasFilePayload(event)) return;
		event.preventDefault();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) {
			isOverDropZone = false;
		}
	}

	function handleDrop(event: DragEvent) {
		if (!getEnabled() || !hasFilePayload(event)) return;
		event.preventDefault();
		dragDepth = 0;
		isOverDropZone = false;

		const dataTransfer = event.dataTransfer;
		if (!dataTransfer) return;

		const droppedFiles = extractDroppedFiles(dataTransfer);
		if (droppedFiles.length > 0) {
			options.onDrop(droppedFiles);
		}
	}

	/** Spread onto the drop zone element: `<div {...drop.dropZoneProps}>` */
	const dropZoneProps = {
		ondragenter: handleDragEnter,
		ondragover: handleDragOver,
		ondragleave: handleDragLeave,
		ondrop: handleDrop
	};

	return {
		get isOverDropZone() {
			return isOverDropZone;
		},
		get dragDepth() {
			return dragDepth;
		},
		handleDragEnter,
		handleDragOver,
		handleDragLeave,
		handleDrop,
		dropZoneProps
	};
}
