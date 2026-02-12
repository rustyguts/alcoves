<script setup lang="ts">
import type { InviteLookupResponse } from "~~/shared/types/api";

definePageMeta({
  layout: "dashboard",
});

const route = useRoute();
const token = computed(() => route.params.token as string);
const toast = useToast();
const accepting = ref(false);

const {
  data: invite,
  status,
  refresh,
} = await useFetch<InviteLookupResponse>(() => `/api/invites/${token.value}`);

const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

const inviteTitle = computed(() => {
  if (!invite.value) return "Library invite";
  return `${invite.value.invitedBy.displayName} has invited you to join ${invite.value.library.name}`;
});

const statusMessage = computed(() => {
  switch (invite.value?.status) {
    case "pending":
      return "Accept this invitation to get access to the library.";
    case "accepted":
      return "This invitation has already been accepted.";
    case "already_member":
      return "You already have access to this library.";
    case "expired":
      return "This invitation has expired.";
    case "revoked":
      return "This invitation was revoked by a library admin.";
    case "not_allowed":
      return "This invitation is restricted to a different email address.";
    default:
      return "Invite details unavailable.";
  }
});

async function acceptInvite() {
  if (!invite.value?.canAccept) return;

  accepting.value = true;
  try {
    const result = await $fetch<{ libraryId: string; libraryName: string }>(
      `/api/invites/${token.value}/accept`,
      {
        method: "POST",
      },
    );

    await refreshLibraries?.();
    toast.add({ title: `Joined ${result.libraryName}` });
    await navigateTo(`/libraries/${result.libraryId}`);
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { message?: string } })?.data?.message ?? "Failed to accept invite",
      color: "error",
    });
    await refresh();
  } finally {
    accepting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl py-6">
    <UCard>
      <template #header>
        <div class="flex items-center gap-3">
          <UAvatar
            v-if="invite"
            :src="invite.invitedBy.avatarUrl ?? undefined"
            :alt="invite.invitedBy.displayName"
            size="md"
          />
          <div>
            <h1 class="text-lg font-semibold">{{ inviteTitle }}</h1>
            <p class="text-sm text-muted">
              <template v-if="invite?.invitedEmail">Access level: {{ invite.role }}</template>
              <template v-else>Access level can be adjusted after you join.</template>
            </p>
          </div>
        </div>
      </template>

      <div v-if="status === 'pending'" class="flex items-center justify-center py-8">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div v-else class="flex flex-col gap-4">
        <p class="text-sm text-muted">{{ statusMessage }}</p>

        <div class="flex items-center gap-2">
          <UButton
            v-if="invite?.canAccept"
            label="Accept Invite"
            icon="i-lucide-check"
            :loading="accepting"
            @click="acceptInvite"
          />
          <UButton
            v-if="invite?.library.id"
            label="Go to library"
            color="neutral"
            variant="outline"
            icon="i-lucide-arrow-right"
            :to="`/libraries/${invite.library.id}`"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
