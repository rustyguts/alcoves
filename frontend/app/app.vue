<script setup lang="ts">
import { useRoute } from "vue-router";
import { useUploadQueue } from "~/composables/useUploadQueue";
import DashboardLayout from "~/layouts/dashboard.vue";
import UploadProgress from "~/components/UploadProgress.vue";
import ToastContainer from "~/components/ToastContainer.vue";

const route = useRoute();
const { hasInFlightUploads } = useUploadQueue();

const isDashboard = computed(() => route.meta.layout === "dashboard");

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
  <div>
    <DashboardLayout v-if="isDashboard">
      <RouterView />
    </DashboardLayout>
    <RouterView v-else />
    <UploadProgress />
    <ToastContainer />
  </div>
</template>
