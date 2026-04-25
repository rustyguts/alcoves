<script setup lang="ts">
import UploadProgress from "~/components/UploadProgress.vue";

const { hasInFlightUploads } = useUploadQueue();

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasInFlightUploads.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
});
</script>

<template>
  <UApp>
    <div class="h-full text-default">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
      <ClientOnly>
        <UploadProgress />
      </ClientOnly>
    </div>
  </UApp>
</template>
