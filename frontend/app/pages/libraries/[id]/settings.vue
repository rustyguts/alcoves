<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { useLibraryMembers } from "~/composables/useLibraryMembers";
import { useToast } from "~/composables/useToast";
import { apiFetch } from "~/utils/api-fetch";
import type { Library, LibraryUsersResponse } from "~~/shared/types/api";
import AppIcon from "~/components/AppIcon.vue";

const router = useRouter();
const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const { user } = useAuth();
const toast = useToast();
const refreshLibraries = inject<() => Promise<void>>("refreshLibraries");

const { data: library, refresh: refreshLibrary } = useApiFetch<Library>(
  () => `/api/libraries/${libraryId.value}`,
);
const { data: libraryUsers, refresh: refreshLibraryUsers } = useApiFetch<LibraryUsersResponse>(
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

const fileCounts = ref<{ totalCount: number; trashedCount: number } | null>(null);

async function fetchFileCounts() {
  try {
    const [activeFiles, trashedFiles] = await Promise.all([
      apiFetch<{ totalCount: number }>(`/api/libraries/${libraryId.value}/files`, {
        query: { limit: "1" },
      }),
      apiFetch<{ totalCount: number }>(`/api/libraries/${libraryId.value}/files`, {
        query: { trashed: "true", limit: "1" },
      }),
    ]);

    fileCounts.value = {
      totalCount: activeFiles.totalCount ?? 0,
      trashedCount: trashedFiles.totalCount ?? 0,
    };
  } catch {
    // Ignore errors
  }
}

// Fetch file counts on mount and when libraryId changes
watch(libraryId, () => {
  fetchFileCounts();
}, { immediate: true });

async function refreshFileCounts() {
  await fetchFileCounts();
}

const isLibraryManager = computed(() => {
  if (library.value?.ownerId && user.value?.id && library.value.ownerId === user.value.id) {
    return true;
  }

  const membership = libraryUsers.value?.members.find((member) => member.userId === user.value?.id);
  return membership?.role === "owner" || membership?.role === "admin";
});

async function saveLibraryName(name: string) {
  await apiFetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { name },
  });
  await refreshLibrary();
}

async function saveLibraryEmoji(emoji: string | null) {
  await apiFetch(`/api/libraries/${libraryId.value}`, {
    method: "PATCH",
    body: { emoji: emoji ?? "" },
  });
  await refreshLibrary();
}

watchEffect(() => {
  if (library.value && !isLibraryManager.value) {
    router.push(`/libraries/${libraryId.value}`);
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
    await apiFetch(`/api/libraries/${libraryId.value}`, {
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
    await apiFetch(`/api/libraries/${libraryId.value}`, {
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
    const result = await apiFetch<{ queuedCount: number }>(
      `/api/libraries/${libraryId.value}/face-recognition/reprocess`,
      { method: "POST" },
    );
    toast.add({
      title: "Reprocessing queued",
      description: `${result.queuedCount} image${result.queuedCount === 1 ? "" : "s"} queued for fresh facial recognition.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to queue facial recognition reprocessing";
    toast.add({ title: message, color: "error" });
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
    await apiFetch(`/api/libraries/${libraryId.value}`, { method: "DELETE" });
    deleteLibraryOpen.value = false;
    await refreshLibraries?.();
    router.push("/");
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
  <div class="space-y-4 overflow-y-auto flex-1 min-h-0">
    <!-- Library Members Card -->
    <div v-if="!library?.isDefault" class="card bg-base-100 shadow-sm">
      <div class="px-6 pt-5 pb-0">
        <div class="min-w-0">
          <p class="text-sm font-semibold">Library Members</p>
          <p class="text-xs text-muted">
            Manage who has access to this library and their permissions.
          </p>
        </div>
      </div>
      <div class="card-body">
        <div class="space-y-6">
          <div>
            <p class="text-sm font-medium mb-2">Invite by Email</p>
            <p class="text-xs text-muted mb-3">
              Add a specific user directly or send a targeted invite.
            </p>
            <div class="flex flex-col sm:flex-row gap-2">
              <div class="flex-1 relative">
                <AppIcon name="i-lucide-mail" class="size-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
                <input
                  v-model="inviteEmail"
                  type="email"
                  placeholder="user@example.com"
                  class="input w-full pl-9"
                  @keydown.enter="inviteUserByEmail"
                />
              </div>
              <select
                v-model="inviteEmailRole"
                class="select w-full sm:w-32"
              >
                <option
                  v-for="item in inviteRoleOptions"
                  :key="item.value"
                  :value="item.value"
                >{{ item.label }}</option>
              </select>
              <button
                class="btn btn-primary"
                :disabled="!inviteEmail.trim() || inviteByEmailLoading"
                @click="inviteUserByEmail"
              >
                <span v-if="inviteByEmailLoading" class="loading loading-spinner loading-xs"></span>
                <AppIcon v-else name="i-lucide-user-plus" class="size-4" />
                Invite
              </button>
            </div>
          </div>

          <div v-if="inviteLinks.length">
            <div class="flex items-center justify-between gap-3 mb-3">
              <div>
                <p class="text-sm font-medium">Invite Links</p>
                <p class="text-xs text-muted">Reusable links for authenticated users.</p>
              </div>
              <button
                class="btn btn-sm btn-primary"
                :disabled="createInviteLinkLoading"
                @click="createInviteLink"
              >
                <span v-if="createInviteLinkLoading" class="loading loading-spinner loading-xs"></span>
                <AppIcon v-else name="i-lucide-link" class="size-4" />
                Create Link
              </button>
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
                  <button
                    class="btn btn-sm btn-ghost btn-outline"
                    @click="copyInviteLink(invite.inviteUrl)"
                  >
                    <AppIcon name="i-lucide-copy" class="size-4" />
                  </button>
                  <button
                    class="btn btn-sm btn-error btn-soft"
                    :disabled="revokingInviteId === invite.id"
                    @click="revokeInvite(invite.id)"
                  >
                    <span v-if="revokingInviteId === invite.id" class="loading loading-spinner loading-xs"></span>
                    <AppIcon v-else name="i-lucide-x" class="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium">Invite Links</p>
              <p class="text-xs text-muted">Reusable links for authenticated users.</p>
            </div>
            <button
              class="btn btn-sm btn-primary"
              :disabled="createInviteLinkLoading"
              @click="createInviteLink"
            >
              <span v-if="createInviteLinkLoading" class="loading loading-spinner loading-xs"></span>
              <AppIcon v-else name="i-lucide-link" class="size-4" />
              Create Link
            </button>
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
                  <div class="avatar">
                    <div class="w-8 rounded-full">
                      <img
                        :src="member.user.avatarUrl ?? undefined"
                        :alt="member.user.displayName"
                      />
                    </div>
                  </div>
                  <div class="min-w-0">
                    <p class="text-sm font-medium truncate">{{ member.user.displayName }}</p>
                    <p class="text-xs text-muted truncate">{{ member.user.email }}</p>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <span
                    v-if="member.role === 'owner'"
                    class="badge badge-sm badge-primary"
                  >owner</span>
                  <template v-else>
                    <select
                      v-model="memberRoleDrafts[member.userId]"
                      class="select w-28"
                      :disabled="updatingMemberUserId === member.userId"
                      @change="updateMemberRole(member)"
                    >
                      <option
                        v-for="item in inviteRoleOptions"
                        :key="item.value"
                        :value="item.value"
                      >{{ item.label }}</option>
                    </select>
                    <button
                      class="btn btn-sm btn-error btn-soft"
                      :disabled="removingMemberUserId === member.userId"
                      @click="removeMember(member)"
                    >
                      <span v-if="removingMemberUserId === member.userId" class="loading loading-spinner loading-xs"></span>
                      <AppIcon v-else name="i-lucide-user-minus" class="size-4" />
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div v-if="emailInvites.length">
            <div class="flex items-center justify-between gap-2 mb-3">
              <p class="text-sm font-medium">Pending Email Invites</p>
              <span class="badge badge-sm badge-soft badge-neutral">{{ emailInvites.length }} pending</span>
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
                  <span class="badge badge-sm badge-outline badge-neutral">{{ invite.role }}</span>
                  <button
                    class="btn btn-sm btn-ghost btn-outline"
                    @click="copyInviteLink(invite.inviteUrl)"
                  >
                    <AppIcon name="i-lucide-copy" class="size-4" />
                  </button>
                  <button
                    class="btn btn-sm btn-error btn-soft"
                    :disabled="revokingInviteId === invite.id"
                    @click="revokeInvite(invite.id)"
                  >
                    <span v-if="revokingInviteId === invite.id" class="loading loading-spinner loading-xs"></span>
                    <AppIcon v-else name="i-lucide-x" class="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Facial Recognition Card -->
    <div class="card bg-base-100 shadow-sm">
      <div class="px-6 pt-5 pb-0">
        <div class="min-w-0">
          <p class="text-sm font-semibold">Facial Recognition</p>
          <p class="text-xs text-muted">
            Detect and group faces from image uploads in this library. Disabled by default.
          </p>
        </div>
      </div>
      <div class="card-body">
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm font-medium">Enable facial recognition</p>
              <p class="text-xs text-muted">
                Turning this off removes all detected face and people data for this library.
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              :checked="library?.faceRecognitionEnabled ?? false"
              :disabled="faceRecToggling"
              @change="toggleFaceRecognition(($event.target as HTMLInputElement).checked)"
            />
          </div>

          <div class="flex items-center justify-between gap-4">
            <div class="min-w-0">
              <p class="text-sm font-medium">Queue full reprocessing</p>
              <p class="text-xs text-muted">
                Deletes current face inference data, then re-runs detection on all images.
              </p>
            </div>
            <button
              class="btn btn-neutral"
              :disabled="!library?.faceRecognitionEnabled || faceRecToggling || faceRecReprocessing"
              @click="faceRecReprocessOpen = true"
            >
              <span v-if="faceRecReprocessing" class="loading loading-spinner loading-xs"></span>
              <AppIcon v-else name="i-lucide-refresh-cw" class="size-4" />
              Reprocess Faces
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Danger Zone Card -->
    <div class="card bg-base-100 shadow-sm">
      <div class="px-6 pt-5 pb-0">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-error">Danger Zone</p>
          <p class="text-xs text-muted">Deleting a library is permanent and cannot be undone.</p>
        </div>
      </div>
      <div class="card-body">
        <div class="flex items-center justify-between gap-4">
          <p class="text-xs text-muted">
            Only the library owner can delete a non-default library after all files are removed.
          </p>
          <button
            class="btn btn-error btn-soft"
            :disabled="!canDeleteLibrary"
            @click="deleteLibraryOpen = true"
          >
            <AppIcon name="i-lucide-trash-2" class="size-4" />
            Delete Library
          </button>
        </div>
      </div>
    </div>

    <!-- Disable Face Recognition Modal -->
    <dialog class="modal" :class="{ 'modal-open': faceRecDisableOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Disable Facial Recognition</h3>
        <p class="text-sm text-muted py-4">
          This will permanently delete all detected faces and people data for this library. This
          action cannot be undone.
        </p>
        <div class="modal-action">
          <button
            class="btn btn-outline btn-neutral"
            @click="faceRecDisableOpen = false"
          >Cancel</button>
          <button
            class="btn btn-error"
            :disabled="faceRecToggling"
            @click="confirmDisableFaceRecognition"
          >
            <span v-if="faceRecToggling" class="loading loading-spinner loading-xs"></span>
            <AppIcon v-else name="i-lucide-trash-2" class="size-4" />
            Disable & Delete Data
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="faceRecDisableOpen = false">
        <button>close</button>
      </form>
    </dialog>

    <!-- Reprocess Face Recognition Modal -->
    <dialog class="modal" :class="{ 'modal-open': faceRecReprocessOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Reprocess Facial Recognition</h3>
        <p class="text-sm text-muted py-4">
          This deletes all existing face inference data and queues a full rebuild. Results may
          change, including how photos are grouped into people.
        </p>
        <div class="modal-action">
          <button
            class="btn btn-outline btn-neutral"
            :disabled="faceRecReprocessing"
            @click="faceRecReprocessOpen = false"
          >Cancel</button>
          <button
            class="btn btn-warning"
            :disabled="faceRecReprocessing"
            @click="reprocessFaceRecognition"
          >
            <span v-if="faceRecReprocessing" class="loading loading-spinner loading-xs"></span>
            <AppIcon v-else name="i-lucide-refresh-cw" class="size-4" />
            Delete Data & Requeue
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="faceRecReprocessOpen = false">
        <button>close</button>
      </form>
    </dialog>

    <!-- Delete Library Modal -->
    <dialog class="modal" :class="{ 'modal-open': deleteLibraryOpen }">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Delete Library</h3>
        <div class="flex flex-col gap-4 py-4">
          <p class="text-sm text-muted">
            This will permanently delete the library
            <strong>{{ library?.name }}</strong
            >. This action cannot be undone.
          </p>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Type 'delete' to confirm</legend>
            <input v-model="deleteLibraryConfirmation" placeholder="delete" class="input w-full" />
          </fieldset>
        </div>
        <div class="modal-action">
          <button
            class="btn btn-outline btn-neutral"
            @click="deleteLibraryOpen = false"
          >Cancel</button>
          <button
            class="btn btn-error"
            :disabled="deleteLibraryConfirmation !== 'delete'"
            @click="deleteLibrary"
          >
            <AppIcon name="i-lucide-trash-2" class="size-4" />
            Delete Library
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="deleteLibraryOpen = false">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
