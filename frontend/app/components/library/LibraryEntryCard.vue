<script setup lang="ts">
import type { LibraryEntry, LibraryFile } from "~~/shared/types/api";
import { apiUrl } from "~/utils/api-fetch";
import { getMimeIcon } from "~/utils/mime-icons";
import AppIcon from "~/components/AppIcon.vue";
import AlcovesImage from "~/components/AlcovesImage.vue";

interface Props {
  entry: LibraryEntry;
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
</script>

<template>
  <div
    class="rounded-xl overflow-hidden cursor-pointer transition-colors select-none shadow-sm"
    :class="[
      props.isEntrySelected(props.entry)
        ? 'bg-primary/20 hover:bg-primary/28'
        : 'bg-elevated hover:bg-primary/10',
      props.dropTargetFolderId === props.entry.id && props.entry.kind === 'folder'
        ? 'ring-2 ring-primary/60 bg-primary/10'
        : '',
      props.draggedFileIds.includes(props.entry.id) && props.entry.kind === 'file'
        ? 'opacity-60'
        : '',
    ]"
    :draggable="props.dragEnabled && props.entry.kind === 'file' && !props.isRenaming(props.entry)"
    @click="emit('rowClick', props.entry, $event)"
    @dblclick="emit('rowDoubleClick', props.entry)"
    @contextmenu="emit('rowContextMenu', props.entry, $event)"
    @dragstart="emit('dragStart', props.entry, $event)"
    @dragend="emit('dragEnd')"
    @dragenter="emit('dragEnter', props.entry)"
    @dragover="emit('dragOver', props.entry, $event)"
    @dragleave="emit('dragLeave', props.entry, $event)"
    @drop="emit('drop', props.entry, $event)"
  >
    <div
      v-if="props.isRenaming(props.entry)"
      :data-rename-input-entry-id="props.entry.id"
      class="px-2 pt-2 pb-2"
    >
      <UInput
        :model-value="renameValue"
        size="sm"
        autofocus
        :ui="{ root: 'w-full' }"
        @update:model-value="emit('updateRenameValue', String($event ?? ''))"
        @blur="emit('saveRename', props.entry)"
        @keydown.enter="emit('saveRename', props.entry)"
        @keydown.escape="emit('cancelRename')"
        @click.stop
      />
    </div>

    <div
      v-else
      class="px-2 flex items-start gap-2 min-w-0"
      :class="props.entry.kind === 'folder' ? 'py-3' : 'pt-2 pb-2'"
    >
      <AppIcon
        :name="props.entry.kind === 'folder' ? 'i-lucide-folder' : getMimeIcon(props.entry.mimeType)"
        class="size-4 mt-0.5 shrink-0 text-muted"
        :class="showTrashed && props.entry.kind === 'file' ? 'opacity-50' : ''"
      />
      <span
        v-if="props.entry.kind === 'folder'"
        class="text-sm font-semibold text-left truncate w-full"
        :title="
          showTrashed
            ? `${props.entry.name} (${props.entry.trashFileCount ?? 0} files)`
            : props.entry.name
        "
      >
        {{
          showTrashed
            ? `${props.entry.name} (${props.entry.trashFileCount ?? 0} files)`
            : props.entry.name
        }}
      </span>
      <span
        v-else
        class="text-sm font-semibold text-left truncate w-full"
        :title="props.entry.name"
      >
        {{ props.entry.name }}
      </span>
      <UTooltip
        v-if="props.entry.kind === 'file' && props.entry.hasDuplicates"
        text="Duplicate of another file in this library"
      >
        <UIcon name="i-lucide-copy" class="size-4 mt-0.5 shrink-0 text-warning" />
      </UTooltip>
      <div v-if="props.entry.tags?.length" class="flex items-center gap-1 shrink-0">
        <span
          v-for="tag in props.entry.tags"
          :key="tag.id"
          class="size-2 rounded-full border border-default/50"
          :title="tag.name"
          :style="{ backgroundColor: tag.color }"
        />
      </div>
    </div>

    <div
      v-if="props.entry.kind === 'file'"
      class="aspect-video w-full bg-default flex items-center justify-center overflow-hidden"
    >
      <template v-if="props.entry.mimeType.startsWith('video/')">
        <div class="relative w-full h-full flex items-center justify-center">
          <AlcovesImage
            v-if="!props.failedThumbnails.has(props.entry.id) && props.entry.thumbnailFileId"
            :library-id="libraryId"
            :file-id="props.entry.thumbnailFileId"
            :alt="props.entry.name"
            :width="props.cardThumbWidth(props.entry)"
            :height="props.cardThumbHeight(props.entry)"
            format="jpeg"
            :quality="82"
            class="w-full h-full object-cover"
            @error="emit('thumbnailError', props.entry.id)"
          />
          <img
            v-else-if="!props.failedThumbnails.has(props.entry.id)"
            :src="apiUrl(`/api/libraries/${libraryId}/files/${props.entry.id}/thumbnail`)"
            :alt="props.entry.name"
            class="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            draggable="false"
            crossorigin="use-credentials"
            @error="emit('thumbnailError', props.entry.id)"
          />
          <AppIcon v-else name="i-lucide-film" class="size-10 text-muted" />
          <div
            v-if="props.entry.proxyStatus === 'processing'"
            class="absolute inset-0 flex items-center justify-center bg-black/40"
          >
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white" />
          </div>
        </div>
      </template>
      <template v-else-if="props.entry.kind === 'file' && props.isImageFile(props.entry)">
        <AlcovesImage
          v-if="!props.failedThumbnails.has(props.entry.id)"
          :library-id="libraryId"
          :file-id="props.entry.id"
          :alt="props.entry.name"
          :width="props.cardThumbWidth(props.entry)"
          :height="props.cardThumbHeight(props.entry)"
          format="jpeg"
          :quality="82"
          :class="props.isSmallImage(props.entry) ? 'object-contain' : 'w-full h-full object-cover'"
          @error="emit('thumbnailError', props.entry.id)"
        />
        <AppIcon v-else name="i-lucide-image" class="size-10 text-muted" />
      </template>
      <template v-else-if="props.entry.kind === 'file'">
        <AppIcon
          :name="getMimeIcon(props.entry.mimeType)"
          class="size-10 text-muted"
          :class="showTrashed ? 'opacity-50' : ''"
        />
      </template>
    </div>
  </div>
</template>
