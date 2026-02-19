<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";
import UserAvatar from "~/components/UserAvatar.vue";
import type { InviteLookupResponse } from "~~/shared/types/api";

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
    const result = await api.invites.accept(token.value);

    await refreshLibraries?.();
    toast.add({ title: `Joined ${result.libraryName}` });
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
  <div class="mx-auto max-w-2xl py-6 overflow-y-auto flex-1 min-h-0">
    <div class="card bg-base-100 shadow-sm">
      <div class="flex items-center gap-3 px-6 pt-5 pb-2">
        <UserAvatar
          v-if="invite"
          :display-name="invite.invitedBy.displayName"
          :avatar-url="invite.invitedBy.avatarUrl"
          size-class="w-10"
          bg-class="bg-primary text-primary-content"
          text-size-class="text-sm"
        />
        <div>
          <h1 class="text-lg font-semibold">{{ inviteTitle }}</h1>
          <p class="text-sm text-muted">
            <template v-if="invite?.invitedEmail">Access level: {{ invite.role }}</template>
            <template v-else>Access level can be adjusted after you join.</template>
          </p>
        </div>
      </div>

      <div class="card-body">
        <div v-if="status === 'pending'" class="flex items-center justify-center py-8">
          <AppIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
        </div>

        <div v-else class="flex flex-col gap-4">
          <p class="text-sm text-muted">{{ statusMessage }}</p>

          <div class="flex items-center gap-2">
            <button
              v-if="invite?.canAccept"
              class="btn btn-soft btn-primary"
              :disabled="accepting"
              @click="acceptInvite"
            >
              <span v-if="accepting" class="loading loading-spinner loading-xs"></span>
              <AppIcon v-else name="i-lucide-check" class="size-4" />
              Accept Invite
            </button>
            <RouterLink
              v-if="invite?.library.id"
              :to="`/libraries/${invite.library.id}`"
              class="btn btn-soft btn-outline"
            >
              <AppIcon name="i-lucide-arrow-right" class="size-4" />
              Go to library
            </RouterLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
