<script setup lang="ts">
import { apiFetch, ApiError } from "~/utils/api-fetch";

definePageMeta({ layout: false });

interface ShareMetadata {
  token: string;
  title: string;
  description: string;
  shareUrl: string;
  appUrl: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  ready: boolean;
}

const route = useRoute();
const token = computed(() => route.params.token as string);

const { data: share, error } = await useAsyncData(
  () => `share:${token.value}`,
  async () => {
    try {
      return await apiFetch<ShareMetadata>(`/api/share/${token.value}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
);

if (!share.value && !error.value) {
  throw createError({ statusCode: 404, statusMessage: "Share not found", fatal: true });
}

const meta = computed(() => share.value);

useSeoMeta({
  title: () => (meta.value ? `${meta.value.title} · Alcoves` : "Alcoves"),
  description: () => meta.value?.description ?? "",
  ogTitle: () => meta.value?.title ?? "",
  ogDescription: () => meta.value?.description ?? "",
  ogType: "video.other",
  ogUrl: () => meta.value?.shareUrl ?? "",
  ogVideo: () => meta.value?.videoUrl ?? "",
  ogVideoType: () => (meta.value?.videoUrl ? ("video/mp4" as const) : undefined),
  ogVideoWidth: () => (meta.value?.videoUrl ? 1920 : undefined),
  ogVideoHeight: () => (meta.value?.videoUrl ? 1080 : undefined),
  ogImage: () => meta.value?.thumbnailUrl ?? "",
  twitterCard: "player",
  twitterTitle: () => meta.value?.title ?? "",
  twitterDescription: () => meta.value?.description ?? "",
  twitterPlayer: () => meta.value?.shareUrl ?? "",
  twitterPlayerWidth: () => (meta.value?.videoUrl ? 1920 : undefined),
  twitterPlayerHeight: () => (meta.value?.videoUrl ? 1080 : undefined),
  twitterImage: () => meta.value?.thumbnailUrl ?? "",
});
</script>

<template>
  <div class="min-h-screen flex flex-col bg-neutral-950 text-neutral-50">
    <header class="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
      <span class="font-bold tracking-tight">Alcoves</span>
      <span class="text-neutral-500">· shared moment</span>
    </header>

    <main class="flex-1 flex flex-col items-center gap-4 px-4 py-6">
      <div v-if="meta" class="w-full max-w-5xl">
        <h1 class="text-2xl font-semibold mb-1">{{ meta.title }}</h1>
        <p v-if="meta.description" class="text-neutral-400 whitespace-pre-wrap mb-3">
          {{ meta.description }}
        </p>
      </div>

      <div
        v-if="meta?.videoUrl"
        class="w-full max-w-5xl aspect-video rounded-xl overflow-hidden bg-black shadow-2xl"
      >
        <video
          class="w-full h-full block"
          controls
          preload="metadata"
          :poster="meta.thumbnailUrl"
          :src="meta.videoUrl"
        />
      </div>
      <div
        v-else
        class="w-full max-w-5xl rounded-xl border border-dashed border-neutral-700 p-8 text-center text-neutral-400"
      >
        <strong class="text-neutral-200 block">Still processing.</strong>
        The encoded clip isn't ready yet. Refresh in a moment.
      </div>
    </main>

    <footer class="border-t border-neutral-800 py-4 text-center text-sm text-neutral-500">
      <a v-if="meta" :href="meta.appUrl" class="text-emerald-500 hover:text-emerald-400">
        View on Alcoves
      </a>
    </footer>
  </div>
</template>
