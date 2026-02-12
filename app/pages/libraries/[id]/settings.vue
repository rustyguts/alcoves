<script setup lang="ts">
import type { LibraryUsersResponse } from "~~/shared/types/api";

definePageMeta({
  layout: "dashboard",
});

const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const { user } = useAuth();
const toast = useToast();
const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

const { data: library, refresh: refreshLibrary } = await useFetch(
  () => `/api/libraries/${libraryId.value}`,
);
const { data: libraryUsers, refresh: refreshLibraryUsers } = await useFetch<LibraryUsersResponse>(
  () => `/api/libraries/${libraryId.value}/users`,
);

const {
  memberRoleDrafts,
  inviteEmail,
  inviteEmailRole,
  inviteByEmailLoading,
  createInviteLinkLoading,
  updatingMemberUserId,
  removingMemberUserId,
  revokingInviteId,
  inviteRoleOptions,
  libraryMembers,
  emailInvites,
  inviteLinks,
  copyInviteLink,
  inviteUserByEmail,
  createInviteLink,
  updateMemberRole,
  removeMember,
  revokeInvite,
} = useLibraryMembers(libraryId, libraryUsers, refreshLibraryUsers);
const { data: fileCounts, refresh: refreshFileCounts } = await useAsyncData(
  () => `library-settings-counts-${libraryId.value}`,
  async () => {
    const [activeFiles, trashedFiles] = await Promise.all([
      $fetch<{ totalCount: number }>(`/api/libraries/${libraryId.value}/files`, {
        query: { limit: "1" },
      }),
      $fetch<{ totalCount: number }>(`/api/libraries/${libraryId.value}/files`, {
        query: { trashed: "true", limit: "1" },
      }),
    ]);

    return {
      totalCount: activeFiles.totalCount ?? 0,
      trashedCount: trashedFiles.totalCount ?? 0,
    };
  },
  { watch: [libraryId] },
);

const isLibraryManager = computed(() => {
  if (library.value?.ownerId && user.value?.id && library.value.ownerId === user.value.id) {
    return true;
  }

  const membership = libraryUsers.value?.members.find((member) => member.userId === user.value?.id);
  return membership?.role === "owner" || membership?.role === "admin";
});

watchEffect(async () => {
  if (library.value && !isLibraryManager.value) {
    await navigateTo(`/libraries/${libraryId.value}`);
  }
});

const faceRecToggling = ref(false);
const faceRecDisableOpen = ref(false);
const faceRecReprocessOpen = ref(false);
const faceRecReprocessing = ref(false);
const deleteLibraryOpen = ref(false);
const deleteLibraryConfirmation = ref("");

async function toggleFaceRecognition(enabled: boolean) {
  if (!enabled) {
    faceRecDisableOpen.value = true;
    return;
  }

  faceRecToggling.value = true;
  try {
    await $fetch(`/api/libraries/${libraryId.value}`, {
      method: "PATCH",
      body: { faceRecognitionEnabled: true },
    });
    await refreshLibrary();
    toast.add({ title: "Face recognition enabled. Processing will begin shortly." });
  } catch {
    toast.add({ title: "Failed to enable face recognition", color: "error" });
  } finally {
    faceRecToggling.value = false;
  }
}

async function confirmDisableFaceRecognition() {
  faceRecToggling.value = true;
  faceRecDisableOpen.value = false;
  try {
    await $fetch(`/api/libraries/${libraryId.value}`, {
      method: "PATCH",
      body: { faceRecognitionEnabled: false },
    });
    await refreshLibrary();
    toast.add({ title: "Face recognition disabled. All face data has been deleted." });
  } catch {
    toast.add({ title: "Failed to disable face recognition", color: "error" });
  } finally {
    faceRecToggling.value = false;
  }
}

async function reprocessFaceRecognition() {
  faceRecReprocessing.value = true;
  faceRecReprocessOpen.value = false;
  try {
    const result = await $fetch<{ queuedCount: number }>(
      `/api/libraries/${libraryId.value}/face-recognition/reprocess`,
      { method: "POST" },
    );
    toast.add({
      title: "Reprocessing queued",
      description: `${result.queuedCount} image${result.queuedCount === 1 ? "" : "s"} queued for fresh facial recognition.`,
    });
  } catch {
    toast.add({ title: "Failed to queue facial recognition reprocessing", color: "error" });
  } finally {
    faceRecReprocessing.value = false;
  }
}

const canDeleteLibrary = computed(() => {
  if (!library.value || !user.value) return false;
  if (library.value.isDefault) return false;
  if (library.value.ownerId !== user.value.id) return false;
  if ((fileCounts.value?.totalCount ?? 0) > 0 || (fileCounts.value?.trashedCount ?? 0) > 0) {
    return false;
  }
  return true;
});

async function deleteLibrary() {
  try {
    await $fetch(`/api/libraries/${libraryId.value}`, { method: "DELETE" });
    deleteLibraryOpen.value = false;
    await refreshLibraries?.();
    await navigateTo("/");
  } catch {
    toast.add({
      title: "Failed to delete library",
      description: "Library must be empty before it can be deleted.",
      color: "error",
    });
    await refreshFileCounts();
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold truncate">Library Settings</h1>
        <p class="text-sm text-muted">
          Manage settings for <strong>{{ library?.name ?? "this library" }}</strong
          >.
        </p>
      </div>
      <UButton
        label="Back to Library"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="outline"
        :to="`/libraries/${libraryId}`"
      />
    </div>

    <UCard v-if="!library?.isDefault">
      <template #header>
        <div class="min-w-0">
          <p class="text-sm font-semibold">Library Members</p>
          <p class="text-xs text-muted">
            Manage who has access to this library and their permissions.
          </p>
        </div>
      </template>

      <div class="space-y-6">
        <div>
          <p class="text-sm font-medium mb-2">Invite by Email</p>
          <p class="text-xs text-muted mb-3">
            Add a specific user directly or send a targeted invite.
          </p>
          <div class="flex flex-col sm:flex-row gap-2">
            <UInput
              v-model="inviteEmail"
              type="email"
              placeholder="user@example.com"
              icon="i-lucide-mail"
              class="flex-1"
              @keydown.enter="inviteUserByEmail"
            />
            <USelectMenu
              v-model="inviteEmailRole"
              :items="inviteRoleOptions"
              value-key="value"
              class="w-full sm:w-32"
            />
            <UButton
              label="Invite"
              icon="i-lucide-user-plus"
              :loading="inviteByEmailLoading"
              :disabled="!inviteEmail.trim()"
              @click="inviteUserByEmail"
            />
          </div>
        </div>

        <div v-if="inviteLinks.length">
          <div class="flex items-center justify-between gap-3 mb-3">
            <div>
              <p class="text-sm font-medium">Invite Links</p>
              <p class="text-xs text-muted">Reusable links for authenticated users.</p>
            </div>
            <UButton
              label="Create Link"
              icon="i-lucide-link"
              size="sm"
              :loading="createInviteLinkLoading"
              @click="createInviteLink"
            />
          </div>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="invite in inviteLinks"
              :key="invite.id"
              class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ invite.inviteUrl }}</p>
                <p class="text-xs text-muted">
                  Used {{ invite.useCount }} {{ invite.useCount === 1 ? "time" : "times" }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  @click="copyInviteLink(invite.inviteUrl)"
                />
                <UButton
                  icon="i-lucide-x"
                  color="error"
                  variant="soft"
                  size="sm"
                  :loading="revokingInviteId === invite.id"
                  @click="revokeInvite(invite.id)"
                />
              </div>
            </div>
          </div>
        </div>
        <div v-else class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium">Invite Links</p>
            <p class="text-xs text-muted">Reusable links for authenticated users.</p>
          </div>
          <UButton
            label="Create Link"
            icon="i-lucide-link"
            size="sm"
            :loading="createInviteLinkLoading"
            @click="createInviteLink"
          />
        </div>

        <div v-if="libraryMembers.length">
          <p class="text-sm font-medium mb-3">Members</p>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="member in libraryMembers"
              :key="member.id"
              class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3"
            >
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <UAvatar
                  :src="member.user.avatarUrl ?? undefined"
                  :alt="member.user.displayName"
                  size="sm"
                />
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">{{ member.user.displayName }}</p>
                  <p class="text-xs text-muted truncate">{{ member.user.email }}</p>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <UBadge
                  v-if="member.role === 'owner'"
                  color="primary"
                  variant="subtle"
                  label="owner"
                />
                <template v-else>
                  <USelectMenu
                    v-model="memberRoleDrafts[member.userId]"
                    :items="inviteRoleOptions"
                    value-key="value"
                    class="w-28"
                    :loading="updatingMemberUserId === member.userId"
                    @update:model-value="updateMemberRole(member)"
                  />
                  <UButton
                    icon="i-lucide-user-minus"
                    color="error"
                    variant="soft"
                    size="sm"
                    :loading="removingMemberUserId === member.userId"
                    @click="removeMember(member)"
                  />
                </template>
              </div>
            </div>
          </div>
        </div>

        <div v-if="emailInvites.length">
          <div class="flex items-center justify-between gap-2 mb-3">
            <p class="text-sm font-medium">Pending Email Invites</p>
            <UBadge color="neutral" variant="soft" :label="`${emailInvites.length} pending`" />
          </div>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="invite in emailInvites"
              :key="invite.id"
              class="px-3 py-3 flex flex-col md:flex-row md:items-center gap-3"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ invite.invitedEmail }}</p>
                <p class="text-xs text-muted truncate">{{ invite.inviteUrl }}</p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge color="neutral" variant="outline" :label="invite.role" />
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  @click="copyInviteLink(invite.inviteUrl)"
                />
                <UButton
                  icon="i-lucide-x"
                  color="error"
                  variant="soft"
                  size="sm"
                  :loading="revokingInviteId === invite.id"
                  @click="revokeInvite(invite.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="min-w-0">
          <p class="text-sm font-semibold">Facial Recognition</p>
          <p class="text-xs text-muted">
            Detect and group faces from image uploads in this library. Disabled by default.
          </p>
        </div>
      </template>

      <div class="space-y-4">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="text-sm font-medium">Enable facial recognition</p>
            <p class="text-xs text-muted">
              Turning this off removes all detected face and people data for this library.
            </p>
          </div>
          <USwitch
            :model-value="library?.faceRecognitionEnabled ?? false"
            :loading="faceRecToggling"
            @update:model-value="toggleFaceRecognition"
          />
        </div>

        <div class="flex items-center justify-between gap-4 rounded-lg border border-default p-3">
          <div class="min-w-0">
            <p class="text-sm font-medium">Queue full reprocessing</p>
            <p class="text-xs text-muted">
              Deletes current face inference data, then re-runs detection on all images.
            </p>
          </div>
          <UButton
            label="Reprocess Faces"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :disabled="!library?.faceRecognitionEnabled || faceRecToggling"
            :loading="faceRecReprocessing"
            @click="faceRecReprocessOpen = true"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-error">Danger Zone</p>
          <p class="text-xs text-muted">Deleting a library is permanent and cannot be undone.</p>
        </div>
      </template>

      <div class="flex items-center justify-between gap-4">
        <p class="text-xs text-muted">
          Only the library owner can delete a non-default library after all files are removed.
        </p>
        <UButton
          label="Delete Library"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          :disabled="!canDeleteLibrary"
          @click="deleteLibraryOpen = true"
        />
      </div>
    </UCard>

    <UModal v-model:open="faceRecDisableOpen" title="Disable Facial Recognition">
      <template #body>
        <p class="text-sm text-muted">
          This will permanently delete all detected faces and people data for this library. This
          action cannot be undone.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="faceRecDisableOpen = false"
          />
          <UButton
            label="Disable & Delete Data"
            color="error"
            icon="i-lucide-trash-2"
            :loading="faceRecToggling"
            @click="confirmDisableFaceRecognition"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="faceRecReprocessOpen" title="Reprocess Facial Recognition">
      <template #body>
        <p class="text-sm text-muted">
          This deletes all existing face inference data and queues a full rebuild. Results may
          change, including how photos are grouped into people.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            :disabled="faceRecReprocessing"
            @click="faceRecReprocessOpen = false"
          />
          <UButton
            label="Delete Data & Requeue"
            icon="i-lucide-refresh-cw"
            color="warning"
            :loading="faceRecReprocessing"
            @click="reprocessFaceRecognition"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="deleteLibraryOpen" title="Delete Library">
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">
            This will permanently delete the library
            <strong>{{ library?.name }}</strong
            >. This action cannot be undone.
          </p>
          <UFormField label="Type 'delete' to confirm">
            <UInput v-model="deleteLibraryConfirmation" placeholder="delete" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="deleteLibraryOpen = false"
          />
          <UButton
            label="Delete Library"
            color="error"
            icon="i-lucide-trash-2"
            :disabled="deleteLibraryConfirmation !== 'delete'"
            @click="deleteLibrary"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
