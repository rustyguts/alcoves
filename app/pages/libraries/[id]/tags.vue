<script setup lang="ts">
import type { LibraryFile, LibraryTag } from "~~/shared/types/api";

definePageMeta({
  layout: "dashboard",
});

const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const toast = useToast();

const { data: library } = await useFetch(() => `/api/libraries/${libraryId.value}`);

const libraryTags = ref<LibraryTag[]>([]);
const files = ref<LibraryFile[]>([]);
const loading = ref(true);

const {
  createTagName,
  creatingTag,
  tagDraftNames,
  isTagAssigned,
  isFolderTagAssigned,
  areAllFilesTagged,
  toggleTagForFolder,
  toggleTagForFiles,
  createTag,
  getTagColorChoices,
  isTagColorUsedByAnotherTag,
  selectTagColor,
  saveDraftTagName,
  deleteTag,
} = useLibraryTags(libraryId, libraryTags, files);

async function refreshTags() {
  libraryTags.value = await $fetch<LibraryTag[]>(`/api/libraries/${libraryId.value}/tags`);
}

onMounted(async () => {
  try {
    await refreshTags();
  } catch {
    toast.add({ title: "Failed to load tags", color: "error" });
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-10">
      <h1 class="text-xl font-semibold truncate">{{ library?.name }}</h1>
      <UButton
        label="Back to Library"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
        size="sm"
        :to="`/libraries/${libraryId}`"
      />
    </div>

    <div class="grid gap-4">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-semibold">Create Tag</p>
              <p class="text-xs text-muted">Add labels to organize files and folders.</p>
            </div>
            <UBadge
              color="neutral"
              variant="soft"
              :label="`${libraryTags.length} ${libraryTags.length === 1 ? 'tag' : 'tags'}`"
            />
          </div>
        </template>

        <div class="flex flex-col sm:flex-row sm:items-end gap-2">
          <UFormField label="Tag name" class="flex-1">
            <UInput
              v-model="createTagName"
              placeholder="Design docs"
              icon="i-lucide-tag"
              class="w-full"
              @keydown.enter="createTag"
            />
          </UFormField>
          <UButton
            label="Create Tag"
            icon="i-lucide-plus"
            :loading="creatingTag"
            :disabled="!createTagName.trim()"
            @click="createTag"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm font-semibold">Manage Tags</p>
            <p class="text-xs text-muted">Click a color dot to open the palette.</p>
          </div>
        </template>

        <div
          v-if="libraryTags.length"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <div
            v-for="tag in libraryTags"
            :key="tag.id"
            class="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-3 bg-(--ui-bg)/40"
          >
            <UPopover>
              <button
                type="button"
                class="size-8 rounded-full border-2 border-default cursor-pointer shadow-sm"
                :style="{ backgroundColor: tag.color }"
                :title="`Tag color: ${tag.color}`"
              />
              <template #content>
                <div class="p-2">
                  <div class="flex w-44 flex-wrap gap-2">
                    <button
                      v-for="color in getTagColorChoices(tag)"
                      :key="`${tag.id}-${color}`"
                      type="button"
                      class="aspect-square shrink-0 basis-[calc((100%-1.5rem)/4)] rounded-full border transition-transform disabled:cursor-not-allowed disabled:opacity-35"
                      :class="
                        color === tag.color.toUpperCase()
                          ? 'border-primary ring-2 ring-primary/30 scale-110'
                          : 'border-default hover:scale-105'
                      "
                      :style="{ backgroundColor: color }"
                      :title="isTagColorUsedByAnotherTag(tag.id, color) ? `${color} (used)` : color"
                      :disabled="isTagColorUsedByAnotherTag(tag.id, color)"
                      @click="selectTagColor(tag, color)"
                    />
                  </div>
                </div>
              </template>
            </UPopover>

            <div class="min-w-0 flex-1 flex items-center gap-2">
              <UInput
                v-model="tagDraftNames[tag.id]"
                class="flex-1"
                @blur="saveDraftTagName(tag)"
                @keydown.enter="saveDraftTagName(tag)"
              />
              <UBadge color="neutral" variant="outline" :label="tag.color" class="shrink-0" />
            </div>

            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="soft"
              size="sm"
              class="self-start sm:self-auto sm:ml-auto"
              @click="deleteTag(tag.id)"
            />
          </div>
        </div>

        <div v-else class="rounded-lg border border-dashed border-default p-8 text-center">
          <UIcon name="i-lucide-tags" class="size-8 text-muted mx-auto mb-2" />
          <p class="text-sm font-medium">No tags yet</p>
          <p class="text-xs text-muted mt-1">Create your first tag to start organizing content.</p>
        </div>
      </UCard>
    </div>
  </div>
</template>
