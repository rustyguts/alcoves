<script setup lang="ts">
import { useRoute } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import AppIcon from "~/components/AppIcon.vue";

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
      <AppIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
    </div>

    <div v-else-if="!labels.length" class="card bg-base-100">
      <div class="card-body">
        <div class="flex items-center gap-3 text-muted">
          <AppIcon name="i-lucide-scan-search" class="size-5" />
          <p>No objects detected yet. Upload images to start detecting objects.</p>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="flex items-center gap-3 text-sm text-muted">
        <span class="badge badge-ghost badge-sm">{{ labels.length }} labels</span>
        <span class="badge badge-ghost badge-sm">{{ totalDetections }} total detections</span>
      </div>

      <div class="card bg-base-100">
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Label</th>
                <th class="text-right">Photos</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in labels" :key="item.label" class="hover">
                <td>
                  <span class="badge badge-soft badge-primary">{{ item.label }}</span>
                </td>
                <td class="text-right tabular-nums">
                  {{ item.fileCount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
