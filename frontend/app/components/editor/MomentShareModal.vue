<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import type { MomentShare } from "~~/shared/types/api";

const props = defineProps<{
  open: boolean;
  libraryId: string;
  fileId: string;
  momentId: string | null;
  sharingEnabled: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const toast = useToast();
const shares = ref<MomentShare[]>([]);
const loading = ref(false);
const creating = ref(false);

async function refresh() {
  if (!props.momentId) return;
  loading.value = true;
  try {
    shares.value = await api.moments.listShares(props.libraryId, props.fileId, props.momentId);
  } catch {
    shares.value = [];
  } finally {
    loading.value = false;
  }
}

async function onCreate() {
  if (!props.momentId || !props.sharingEnabled) return;
  creating.value = true;
  try {
    const created = await api.moments.createShare(props.libraryId, props.fileId, props.momentId);
    shares.value = [created, ...shares.value];
    toast.add({ title: "Share link created", color: "success" });
  } catch {
    toast.add({ title: "Failed to create share link", color: "error" });
  } finally {
    creating.value = false;
  }
}

async function onRevoke(token: string) {
  if (!props.momentId) return;
  try {
    await api.moments.revokeShare(props.libraryId, props.fileId, props.momentId, token);
    shares.value = shares.value.filter((s) => s.token !== token);
    toast.add({ title: "Share link revoked", color: "success" });
  } catch {
    toast.add({ title: "Failed to revoke", color: "error" });
  }
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.add({ title: "Link copied", color: "success" });
  } catch {
    toast.add({ title: "Copy failed", color: "error" });
  }
}

watch(
  () => [props.open, props.momentId],
  ([isOpen]) => {
    if (isOpen) refresh();
  },
);
</script>

<template>
  <UModal
    :open="open"
    title="Share moment"
    :description="
      sharingEnabled
        ? 'Anyone with the link can watch this moment. Revoke to kill access.'
        : 'Sharing is disabled for this library. Turn it on in library settings to create share links.'
    "
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-3">
        <UButton
          color="primary"
          icon="i-lineicons-link"
          :disabled="!sharingEnabled || creating"
          :loading="creating"
          @click="onCreate"
        >
          Create share link
        </UButton>

        <div v-if="loading" class="text-sm text-muted">Loading…</div>

        <div v-if="shares.length" class="space-y-2">
          <div
            v-for="s in shares"
            :key="s.id"
            class="rounded-md bg-elevated/50 p-3 flex items-center gap-2"
          >
            <code class="text-xs truncate flex-1">{{ s.url }}</code>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              square
              icon="i-lineicons-clipboard"
              aria-label="Copy link"
              @click="copy(s.url)"
            />
            <UButton
              color="error"
              variant="soft"
              size="xs"
              icon="i-lineicons-x"
              @click="onRevoke(s.token)"
            >
              Revoke
            </UButton>
          </div>
        </div>
        <div
          v-else-if="!loading"
          class="text-sm text-muted rounded-lg border border-dashed border-default p-4 text-center"
        >
          No active share links.
        </div>
      </div>
    </template>
  </UModal>
</template>
