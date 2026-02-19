<script setup lang="ts">
import type { LibraryEntry } from "~~/shared/types/api";
import { formatDate, formatFileSize, getMimeIcon } from "~/utils/mime-icons";
import AppIcon from "~/components/AppIcon.vue";
import UserAvatar from "~/components/UserAvatar.vue";

interface Props {
  entries: LibraryEntry[];
  showTrashed: boolean;
  dragEnabled: boolean;
  draggedFileIds: string[];
  dropTargetFolderId: string | null;
  renameValue: string;
  isEntrySelected: (entry: LibraryEntry) => boolean;
  isRenaming: (entry: LibraryEntry) => boolean;
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
  openFolder: [folderId: string];
  saveRename: [entry: LibraryEntry];
  cancelRename: [];
  updateRenameValue: [value: string];
}>();
</script>

<template>
  <table class="w-full">
    <thead class="sticky top-0 z-10 shadow-[0_1px_0_0] shadow-base-300/70">
      <tr>
        <th class="w-12 px-4 py-3 bg-base-100/90 backdrop-blur-sm rounded-tl-lg" />
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm"
        >
          Name
        </th>
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm"
        >
          Tags
        </th>
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm hidden sm:table-cell"
        >
          Owner
        </th>
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm hidden sm:table-cell"
        >
          {{ showTrashed ? "Trashed" : "Modified" }}
        </th>
        <th
          class="text-right text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm hidden sm:table-cell rounded-tr-lg"
        >
          Size
        </th>
      </tr>
    </thead>
    <tbody class="select-none">
      <template v-for="entry in entries" :key="`${entry.kind}-${entry.id}`">
        <tr
          class="cursor-pointer transition-colors"
          :class="[
            props.isEntrySelected(entry)
              ? 'bg-primary/20 hover:bg-primary/28'
              : 'hover:bg-primary/10',
            props.dropTargetFolderId === entry.id && entry.kind === 'folder'
              ? 'ring-2 ring-primary/60 ring-inset bg-primary/5'
              : '',
            props.draggedFileIds.includes(entry.id) && entry.kind === 'file' ? 'opacity-60' : '',
          ]"
          :draggable="props.dragEnabled && entry.kind === 'file' && !props.isRenaming(entry)"
          @click="emit('rowClick', entry, $event)"
          @dblclick="emit('rowDoubleClick', entry)"
          @contextmenu="emit('rowContextMenu', entry, $event)"
          @dragstart="emit('dragStart', entry, $event)"
          @dragend="emit('dragEnd')"
          @dragenter="emit('dragEnter', entry)"
          @dragover="emit('dragOver', entry, $event)"
          @dragleave="emit('dragLeave', entry, $event)"
          @drop="emit('drop', entry, $event)"
        >
          <td class="px-4 py-3">
            <div class="flex items-center justify-center">
              <AppIcon
                :name="entry.kind === 'folder' ? 'i-lucide-folder' : getMimeIcon(entry.mimeType)"
                class="size-5 text-muted"
                :class="showTrashed && entry.kind === 'file' ? 'opacity-50' : ''"
              />
            </div>
          </td>
          <td class="px-4 py-3">
            <div v-if="props.isRenaming(entry)" :data-rename-input-entry-id="entry.id">
              <input
                :value="renameValue"
                class="input input-sm w-full"
                autofocus
                @input="emit('updateRenameValue', ($event.target as HTMLInputElement).value)"
                @blur="emit('saveRename', entry)"
                @keydown.enter="emit('saveRename', entry)"
                @keydown.escape="emit('cancelRename')"
                @click.stop
              />
            </div>
            <div v-else class="flex items-center gap-1">
              <button
                v-if="entry.kind === 'folder'"
                type="button"
                class="text-sm text-left"
                @click.stop="emit('openFolder', entry.id)"
              >
                {{
                  showTrashed ? `${entry.name} (${entry.trashFileCount ?? 0} files)` : entry.name
                }}
              </button>
              <span v-else class="text-sm text-left" :class="showTrashed ? 'opacity-60' : ''">
                {{ entry.name }}
              </span>
            </div>
          </td>
          <td class="px-4 py-3">
            <div class="flex flex-wrap items-center gap-1.5">
              <span
                v-for="tag in entry.tags"
                :key="tag.id"
                class="size-2.5 rounded-full border border-default/50"
                :title="tag.name"
                :style="{ backgroundColor: tag.color }"
              />
            </div>
          </td>
          <td class="px-4 py-3 text-sm text-muted hidden sm:table-cell">
            <div v-if="entry.owner" class="flex items-center">
              <UserAvatar
                :display-name="entry.owner.displayName"
                :avatar-url="entry.owner.avatarUrl"
                size-class="w-6"
                text-size-class="text-[10px]"
                bg-class="bg-primary/20 text-primary"
                tooltip
                tooltip-position="right"
              />
            </div>
            <span v-else>-</span>
          </td>
          <td class="px-4 py-3 text-sm text-muted hidden sm:table-cell">
            {{
              showTrashed && entry.trashedAt
                ? formatDate(entry.trashedAt)
                : formatDate(entry.updatedAt)
            }}
          </td>
          <td class="px-4 py-3 text-sm text-muted text-right hidden sm:table-cell">
            {{ entry.kind === "folder" ? "-" : formatFileSize(entry.size) }}
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>
