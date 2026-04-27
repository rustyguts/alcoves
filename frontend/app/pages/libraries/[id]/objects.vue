<script setup lang="ts">
import { useApiFetch } from "~/composables/useApiFetch";
import AppIcon from "~/components/AppIcon.vue";

definePageMeta({ layout: "library" });

interface ObjectLabel {
  label: string;
  fileCount: number;
}

interface ObjectLabelsResponse {
  labels: ObjectLabel[];
}

const route = useRoute();
const libraryId = computed(() => route.params.id as string);

const { data, status } = useApiFetch<ObjectLabelsResponse>(
  () => `/api/libraries/${libraryId.value}/objects/labels`,
);

const labels = computed(() => data.value?.labels ?? []);
const totalDetections = computed(() => labels.value.reduce((sum, l) => sum + l.fileCount, 0));
</script>

<template>
  <div class="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0">
    <div v-if="status === 'pending'" class="flex items-center justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </div>

    <UAlert
      v-else-if="!labels.length"
      color="neutral"
      variant="soft"
      icon="i-lucide-scan-search"
      title="No objects detected yet"
      description="Upload images to start detecting objects."
    />

    <template v-else>
      <div class="flex items-center gap-2 text-sm">
        <UBadge color="neutral" variant="soft" size="sm">{{ labels.length }} labels</UBadge>
        <UBadge color="neutral" variant="soft" size="sm"
          >{{ totalDetections }} total detections</UBadge
        >
      </div>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-elevated text-left">
              <tr>
                <th class="px-4 py-3 font-medium">Label</th>
                <th class="px-4 py-3 text-right font-medium">Photos</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr v-for="item in labels" :key="item.label" class="transition hover:bg-elevated/60">
                <td class="px-4 py-3">
                  <UBadge color="primary" variant="soft">{{ item.label }}</UBadge>
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ item.fileCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </template>
  </div>
</template>
