<script setup lang="ts">
import { ICONS } from "~/utils/icons";
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
  saveRename: [entry: LibraryEntry];
  cancelRename: [];
  updateRenameValue: [value: string];
}>();
</script>

<template>
  <table class="w-full">
    <thead class="sticky top-0 z-30 border-b border-default">
      <tr>
        <th class="w-12 px-4 py-3 bg-default/90 backdrop-blur-sm rounded-tl-xl" />
        <th class="text-left text-xs font-semibold uppercase tracking-wide text-toned px-4 py-3 bg-default/90 backdrop-blur-sm">
          Name
        </th>
        <th class="text-left text-xs font-semibold uppercase tracking-wide text-toned px-4 py-3 bg-default/90 backdrop-blur-sm">
          Tags
        </th>
        <th
          class="text-left text-xs font-semibold uppercase tracking-wide text-toned px-4 py-3 bg-default/90 backdrop-blur-sm hidden sm:table-cell">
          Owner
        </th>
        <th
          class="text-left text-xs font-semibold uppercase tracking-wide text-toned px-4 py-3 bg-default/90 backdrop-blur-sm hidden sm:table-cell">
          {{ showTrashed ? "Trashed" : "Modified" }}
        </th>
        <th
          class="text-right text-xs font-semibold uppercase tracking-wide text-toned px-4 py-3 bg-default/90 backdrop-blur-sm hidden sm:table-cell rounded-tr-xl">
          Size
        </th>
      </tr>
    </thead>
    <tbody class="select-none divide-y divide-default/60">
      <template v-for="entry in entries" :key="`${entry.kind}-${entry.id}`">
        <tr class="cursor-pointer transition-colors" :class="[
          props.isEntrySelected(entry)
            ? 'bg-primary/20 hover:bg-primary/28'
            : 'hover:bg-primary/10',
          props.dropTargetFolderId === entry.id && entry.kind === 'folder'
            ? 'ring-2 ring-primary/60 ring-inset bg-primary/5'
            : '',
          props.draggedFileIds.includes(entry.id) && entry.kind === 'file' ? 'opacity-60' : '',
        ]" :draggable="props.dragEnabled && entry.kind === 'file' && !props.isRenaming(entry)"
          @click="emit('rowClick', entry, $event)" @dblclick="emit('rowDoubleClick', entry)"
          @contextmenu="emit('rowContextMenu', entry, $event)" @dragstart="emit('dragStart', entry, $event)"
          @dragend="emit('dragEnd')" @dragenter="emit('dragEnter', entry)" @dragover="emit('dragOver', entry, $event)"
          @dragleave="emit('dragLeave', entry, $event)" @drop="emit('drop', entry, $event)">
          <td class="px-4 py-3">
            <div class="flex items-center justify-center">
              <AppIcon :name="entry.kind === 'folder' ? ICONS.folder : getMimeIcon(entry.mimeType)"
                class="size-5 text-muted" :class="showTrashed && entry.kind === 'file' ? 'opacity-50' : ''" />
            </div>
          </td>
          <td class="px-4 py-3 min-w-0">
            <div v-if="props.isRenaming(entry)" :data-rename-input-entry-id="entry.id">
              <UInput :model-value="renameValue" size="sm" autofocus :ui="{ root: 'w-full' }"
                @update:model-value="emit('updateRenameValue', String($event ?? ''))" @blur="emit('saveRename', entry)"
                @keydown.enter="emit('saveRename', entry)" @keydown.escape="emit('cancelRename')" @click.stop />
            </div>
            <div v-else class="flex items-center gap-1 min-w-0">
              <span v-if="entry.kind === 'folder'"
                class="text-sm font-semibold text-left truncate whitespace-nowrap block" :title="showTrashed ? `${entry.name} (${entry.trashFileCount ?? 0} files)` : entry.name
                  ">
                {{
                  showTrashed ? `${entry.name} (${entry.trashFileCount ?? 0} files)` : entry.name
                }}
              </span>
              <span v-else class="text-sm font-semibold text-left truncate whitespace-nowrap block"
                :class="showTrashed ? 'opacity-60' : ''" :title="entry.name">
                {{ entry.name }}
              </span>
              <UTooltip v-if="entry.kind === 'file' && entry.hasDuplicates"
                text="Duplicate of another file in this library">
                <UBadge color="warning" variant="soft" size="xs" :icon="ICONS.duplicate" class="ml-1">
                  Duplicate
                </UBadge>
              </UTooltip>
            </div>
          </td>
          <td class="px-4 py-3">
            <div class="flex flex-wrap items-center gap-1.5">
              <span v-for="tag in entry.tags" :key="tag.id" class="size-2.5 rounded-full border border-default/50"
                :title="tag.name" :style="{ backgroundColor: tag.color }" />
            </div>
          </td>
          <td class="px-4 py-3 text-sm text-toned hidden sm:table-cell">
            <div v-if="entry.owner" class="flex items-center">
              <UserAvatar :display-name="entry.owner.displayName" :avatar-url="entry.owner.avatarUrl" size-class="w-6"
                text-size-class="text-[10px]" bg-class="bg-primary/20 text-primary" tooltip tooltip-position="right" />
            </div>
            <span v-else>-</span>
          </td>
          <td class="px-4 py-3 text-sm text-toned whitespace-nowrap hidden sm:table-cell">
            {{
              showTrashed && entry.trashedAt
                ? formatDate(entry.trashedAt)
                : formatDate(entry.updatedAt)
            }}
          </td>
          <td class="px-4 py-3 text-sm text-toned text-right whitespace-nowrap hidden sm:table-cell">
            {{ entry.kind === "folder" ? "-" : formatFileSize(entry.size) }}
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>
