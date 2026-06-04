<script setup lang="ts">
import {
  type ImageFormat,
  type ImageVariantName,
  type ResolvedTransform,
  proxyQueryString,
  resolveVariant,
} from "~~/shared/image-variants";

interface Props {
  libraryId: string;
  fileId: string;
  alt?: string;
  /**
   * Named variant from the shared registry (shared/image-variants.ts). Preferred
   * over passing raw width/height/quality/format: it keeps every call site
   * pointing at the single source of truth and guarantees a pre-warm cache hit.
   */
  variant?: ImageVariantName;
  /**
   * Source image dimensions, used to clamp capped variants (card, preview) down
   * to the original's size so the cache key matches what the pre-warm job built.
   * Ignored for fixed variants.
   */
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  // Explicit overrides. When a variant is set these win over the resolved value;
  // without a variant they drive the request directly (legacy / ad-hoc usage).
  width?: number;
  height?: number;
  format?: ImageFormat;
  quality?: number;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  alt: "",
});

const emit = defineEmits<{
  error: [event: Event];
  load: [event: Event];
}>();

const resolved = computed<ResolvedTransform>(() => {
  const base: ResolvedTransform = props.variant
    ? resolveVariant(props.variant, props.sourceWidth, props.sourceHeight)
    : { width: 0, height: 0, quality: 80, format: "jpeg" };
  return {
    width: props.width ?? base.width,
    height: props.height ?? base.height,
    quality: props.quality ?? base.quality,
    format: props.format ?? base.format,
  };
});

const proxySrc = computed(() =>
  apiUrl(`/api/files/proxy/${props.libraryId}/${props.fileId}?${proxyQueryString(resolved.value)}`),
);
</script>

<template>
  <img
    :src="proxySrc"
    :alt="alt"
    :width="resolved.width || undefined"
    :height="resolved.height || undefined"
    :class="$props.class"
    loading="lazy"
    decoding="async"
    draggable="false"
    crossorigin="use-credentials"
    @error="emit('error', $event)"
    @load="emit('load', $event)"
  />
</template>
