<script setup lang="ts">
import { computed } from "vue";
import type { LibraryEntry, LibraryFile, LibraryFolder } from "~~/shared/types/api";
import LibraryEntryCard from "~/components/library/LibraryEntryCard.vue";

interface Props {
  entries: LibraryEntry[];
  libraryId: string;
  showTrashed: boolean;
  dragEnabled: boolean;
  draggedFileIds: string[];
  dropTargetFolderId: string | null;
  renameValue: string;
  isEntrySelected: (entry: LibraryEntry) => boolean;
  isRenaming: (entry: LibraryEntry) => boolean;
  failedThumbnails: Set<string>;
  isImageFile: (file: LibraryFile) => boolean;
  isSmallImage: (file: LibraryFile) => boolean;
  cardThumbWidth: (file: LibraryFile) => number;
  cardThumbHeight: (file: LibraryFile) => number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  rowClick: [entry: LibraryEntry, event: MouseEvent];
  rowDoubleClick: [entry: LibraryEntry];
  rowContextMenu: [entry: LibraryEntry, event: MouseEvent];
  dragStart: [entry: LibraryEntry, event: DragEvent];
  dragEnd: [];
  dragEnter: [entry: LibraryEntry];
  dragOver: [entry: LibraryEntry, event: DragEvent];
  dragLeave: [entry: LibraryEntry, event: DragEvent];
  drop: [entry: LibraryEntry, event: DragEvent];
  saveRename: [entry: LibraryEntry];
  cancelRename: [];
  updateRenameValue: [value: string];
  thumbnailError: [fileId: string];
}>();

// Grid mode separates folders from loose files: folders pinned to the top,
// files below in their own section. Order within each group is preserved.
const folderEntries = computed(() =>
  props.entries.filter((entry): entry is LibraryFolder => entry.kind === "folder"),
);
const fileEntries = computed(() =>
  props.entries.filter((entry): entry is LibraryFile => entry.kind === "file"),
);
</script>

<template>
  <!--
    auto-fill + minmax keeps card width inside a sensible 220-320px band
    regardless of viewport width, instead of stretching to "viewport / N"
    on ultrawide monitors. Combined with the 16:9 thumbnail below this
    gives the consistent card shape the design calls for.
  -->
  <div class="p-3 flex flex-col gap-4">
    <section v-if="folderEntries.length > 0">
      <div class="grid auto-rows-min gap-3 grid-cols-[repeat(auto-fill,minmax(220px,320px))]">
        <LibraryEntryCard
          v-for="entry in folderEntries"
          :key="`folder-${entry.id}`"
          :entry="entry"
          :library-id="libraryId"
          :show-trashed="showTrashed"
          :drag-enabled="dragEnabled"
          :dragged-file-ids="draggedFileIds"
          :drop-target-folder-id="dropTargetFolderId"
          :rename-value="renameValue"
          :is-entry-selected="isEntrySelected"
          :is-renaming="isRenaming"
          :failed-thumbnails="failedThumbnails"
          :is-image-file="isImageFile"
          :is-small-image="isSmallImage"
          :card-thumb-width="cardThumbWidth"
          :card-thumb-height="cardThumbHeight"
          @row-click="(entry, event) => emit('rowClick', entry, event)"
          @row-double-click="emit('rowDoubleClick', $event)"
          @row-context-menu="(entry, event) => emit('rowContextMenu', entry, event)"
          @drag-start="(entry, event) => emit('dragStart', entry, event)"
          @drag-end="emit('dragEnd')"
          @drag-enter="emit('dragEnter', $event)"
          @drag-over="(entry, event) => emit('dragOver', entry, event)"
          @drag-leave="(entry, event) => emit('dragLeave', entry, event)"
          @drop="(entry, event) => emit('drop', entry, event)"
          @save-rename="emit('saveRename', $event)"
          @cancel-rename="emit('cancelRename')"
          @update-rename-value="emit('updateRenameValue', $event)"
          @thumbnail-error="emit('thumbnailError', $event)"
        />
      </div>
    </section>

    <section v-if="fileEntries.length > 0">
      <div class="grid auto-rows-min gap-3 grid-cols-[repeat(auto-fill,minmax(220px,320px))]">
        <LibraryEntryCard
          v-for="entry in fileEntries"
          :key="`file-${entry.id}`"
          :entry="entry"
          :library-id="libraryId"
          :show-trashed="showTrashed"
          :drag-enabled="dragEnabled"
          :dragged-file-ids="draggedFileIds"
          :drop-target-folder-id="dropTargetFolderId"
          :rename-value="renameValue"
          :is-entry-selected="isEntrySelected"
          :is-renaming="isRenaming"
          :failed-thumbnails="failedThumbnails"
          :is-image-file="isImageFile"
          :is-small-image="isSmallImage"
          :card-thumb-width="cardThumbWidth"
          :card-thumb-height="cardThumbHeight"
          @row-click="(entry, event) => emit('rowClick', entry, event)"
          @row-double-click="emit('rowDoubleClick', $event)"
          @row-context-menu="(entry, event) => emit('rowContextMenu', entry, event)"
          @drag-start="(entry, event) => emit('dragStart', entry, event)"
          @drag-end="emit('dragEnd')"
          @drag-enter="emit('dragEnter', $event)"
          @drag-over="(entry, event) => emit('dragOver', entry, event)"
          @drag-leave="(entry, event) => emit('dragLeave', entry, event)"
          @drop="(entry, event) => emit('drop', entry, event)"
          @save-rename="emit('saveRename', $event)"
          @cancel-rename="emit('cancelRename')"
          @update-rename-value="emit('updateRenameValue', $event)"
          @thumbnail-error="emit('thumbnailError', $event)"
        />
      </div>
    </section>
  </div>
</template>
