<script setup lang="ts">
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
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <UploadProgress />
  </UApp>
</template>
