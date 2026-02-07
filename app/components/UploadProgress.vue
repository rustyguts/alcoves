<script setup lang="ts">
import { formatFileSize } from "~/utils/mime-icons";

const { activeUploads, hasActiveUploads, uploadSpeed, retryFile, removeFile } = useUploadQueue();
const expanded = ref(true);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-4 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-4 opacity-0"
    >
      <div
        v-if="hasActiveUploads"
        class="fixed bottom-4 right-4 z-50 w-96 bg-elevated rounded-lg shadow-xl overflow-hidden"
      >
        <div
          class="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none bg-default/40"
          @click="expanded = !expanded"
        >
          <span class="text-sm font-medium">
            Uploading {{ activeUploads.length }}
            {{ activeUploads.length === 1 ? "file" : "files" }}
          </span>
          <div class="flex items-center gap-2">
            <span v-if="uploadSpeed > 0" class="text-xs text-muted">
              {{ formatFileSize(uploadSpeed) }}/s
            </span>
            <UIcon
              :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
              class="size-4 text-muted"
            />
          </div>
        </div>

        <div v-if="expanded" class="max-h-64 overflow-y-auto px-2 py-2 space-y-1">
          <div
            v-for="item in activeUploads"
            :key="item.id"
            class="px-2 py-2 rounded-md bg-default/35"
          >
            <div class="flex items-center justify-between mb-1">
              <span class="text-sm truncate flex-1 mr-2">{{ item.file.name }}</span>
              <span class="text-xs text-muted whitespace-nowrap">{{ item.libraryName }}</span>
            </div>

            <div v-if="item.status === 'uploading'" class="flex items-center gap-2">
              <UProgress :model-value="item.progress" size="xs" class="flex-1" />
              <span class="text-xs text-muted w-8 text-right">{{ item.progress }}%</span>
            </div>

            <div v-else-if="item.status === 'error'" class="flex items-center justify-between">
              <span class="text-xs text-error">{{ item.error }}</span>
              <div class="flex gap-1">
                <UButton
                  v-if="item.retries < 3"
                  label="Retry"
                  size="xs"
                  variant="ghost"
                  @click="retryFile(item.id)"
                />
                <UButton
                  label="Remove"
                  size="xs"
                  variant="ghost"
                  color="error"
                  @click="removeFile(item.id)"
                />
              </div>
            </div>

            <div v-else-if="item.status === 'done'" class="flex items-center gap-1">
              <UIcon name="i-lucide-check" class="size-4 text-success" />
              <span class="text-xs text-success">Complete</span>
            </div>

            <div v-else class="text-xs text-muted">Waiting...</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
