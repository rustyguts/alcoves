import { ref, type Ref } from "vue";

/**
 * Builds a Set of filenames that correspond to directories.
 *
 * Uses the non-standard `webkitGetAsEntry()` API (supported by Chrome, Edge,
 * Firefox, and Safari) to detect directory entries.  Falls back gracefully when
 * the API is unavailable — returning an empty Set so that no files are
 * incorrectly filtered out.
 */
function getDirectoryNames(dataTransfer: DataTransfer): Set<string> {
  const dirs = new Set<string>();
  const items = dataTransfer.items;
  if (!items) return dirs;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.kind !== "file") continue;

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
 *    objects.  This is universally supported and always returns real File
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

    // Skip directories.  On most browsers a directory entry appears in
    // `dataTransfer.files` as a File with size 0 and an empty type.  We
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
    if (types[i] === "Files") return true;
  }
  return false;
}

export interface UseFileDropOptions {
  /**
   * Reactive guard — when it returns `false`, all drag/drop events are ignored.
   * Defaults to a ref that is always `true`.
   */
  enabled?: Ref<boolean>;

  /** Called with the extracted files when the user completes a drop. */
  onDrop: (files: File[]) => void;
}

/**
 * Composable that provides drag-and-drop file upload event handlers and
 * reactive state.
 *
 * Usage:
 * ```vue
 * <div v-bind="dropZoneProps">
 *   <div v-if="isOverDropZone" class="overlay">Drop files here</div>
 *   <!-- content -->
 * </div>
 * ```
 */
export function useFileDrop(options: UseFileDropOptions) {
  const enabled = options.enabled ?? ref(true);
  const isOverDropZone = ref(false);
  const dragDepth = ref(0);

  function handleDragEnter(event: DragEvent) {
    if (!enabled.value || !hasFilePayload(event)) return;
    event.preventDefault();
    dragDepth.value += 1;
    isOverDropZone.value = true;
  }

  function handleDragOver(event: DragEvent) {
    if (!enabled.value || !hasFilePayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(event: DragEvent) {
    if (!enabled.value || !hasFilePayload(event)) return;
    event.preventDefault();
    dragDepth.value = Math.max(0, dragDepth.value - 1);
    if (dragDepth.value === 0) {
      isOverDropZone.value = false;
    }
  }

  function handleDrop(event: DragEvent) {
    if (!enabled.value || !hasFilePayload(event)) return;
    event.preventDefault();
    dragDepth.value = 0;
    isOverDropZone.value = false;

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;

    const droppedFiles = extractDroppedFiles(dataTransfer);
    if (droppedFiles.length > 0) {
      options.onDrop(droppedFiles);
    }
  }

  /** Spread onto the drop zone element: `v-bind="dropZoneProps"` */
  const dropZoneProps = {
    onDragenter: handleDragEnter,
    onDragover: handleDragOver,
    onDragleave: handleDragLeave,
    onDrop: handleDrop,
  };

  return {
    isOverDropZone,
    dragDepth,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    dropZoneProps,
  };
}
