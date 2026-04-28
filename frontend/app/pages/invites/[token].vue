<script setup lang="ts">
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import UserAvatar from "~/components/UserAvatar.vue";
import type { InviteLookupResponse } from "~~/shared/types/api";

definePageMeta({ layout: "dashboard" });

const router = useRouter();
const route = useRoute();
const token = computed(() => route.params.token as string);
const toast = useToast();
const accepting = ref(false);

const {
  data: invite,
  status,
  refresh,
} = useApiFetch<InviteLookupResponse>(() => `/api/invites/${token.value}`);

const { refreshLibraries } = useLibrariesList();

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

const statusColor = computed<"primary" | "success" | "error" | "warning" | "info" | "neutral">(
  () => {
    switch (invite.value?.status) {
      case "pending":
        return "primary";
      case "accepted":
      case "already_member":
        return "success";
      case "expired":
      case "revoked":
      case "not_allowed":
        return "error";
      default:
        return "neutral";
    }
  },
);

async function acceptInvite() {
  if (!invite.value?.canAccept) return;
  accepting.value = true;
  try {
    const result = await api.invites.accept(token.value);
    await refreshLibraries();
    toast.add({ title: `Joined ${result.libraryName}`, color: "success" });
    router.push(`/libraries/${result.libraryId}`);
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
  <div class="mx-auto max-w-2xl py-6 overflow-y-auto flex-1 min-h-0 px-0.5">
    <UCard>
      <template #header>
        <div class="flex items-center gap-3">
          <UserAvatar
            v-if="invite"
            :display-name="invite.invitedBy.displayName"
            :avatar-url="invite.invitedBy.avatarUrl"
            size-class="w-10"
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
        <UAlert :color="statusColor" variant="soft" :description="statusMessage" />

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-if="invite?.canAccept"
            color="primary"
            icon="i-lucide-check"
            :loading="accepting"
            @click="acceptInvite"
          >
            Accept Invite
          </UButton>
          <UButton
            v-if="invite?.library.id"
            :to="`/libraries/${invite.library.id}`"
            color="neutral"
            variant="soft"
            trailing-icon="i-lucide-arrow-right"
          >
            Go to library
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
