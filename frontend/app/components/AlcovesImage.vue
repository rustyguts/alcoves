<script setup lang="ts">
interface Props {
  libraryId: string;
  fileId: string;
  alt?: string;
  width?: number;
  height?: number;
  format?: "jpeg" | "webp" | "avif" | "png";
  quality?: number;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  alt: "",
  format: "jpeg",
  quality: 80,
});

const emit = defineEmits<{
  error: [event: Event];
  load: [event: Event];
}>();

const proxySrc = computed(() => {
  const params: [string, string][] = [["format", props.format]];
  if (props.width) params.push(["width", String(props.width)]);
  if (props.height) params.push(["height", String(props.height)]);
  if (props.quality) params.push(["quality", String(props.quality)]);

  // Sort for consistent URLs that match server-side cache key ordering
  params.sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();

  return apiUrl(`/api/files/proxy/${props.libraryId}/${props.fileId}?${query}`);
});
</script>

<template>
  <img
    :src="proxySrc"
    :alt="alt"
    :width="width"
    :height="height"
    :class="$props.class"
    loading="lazy"
    decoding="async"
    draggable="false"
    crossorigin="use-credentials"
    @error="emit('error', $event)"
    @load="emit('load', $event)"
  />
</template>
