<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";

definePageMeta({ layout: "library" });

import { useApiFetch } from "~/composables/useApiFetch";
import { useLibraryMembers } from "~/composables/useLibraryMembers";
import { useToast } from "~/composables/useToast";
import { api } from "~/api";
import type { Library, LibraryUsersResponse } from "~~/shared/types/api";
import AppIcon from "~/components/AppIcon.vue";
import ConfirmModal from "~/components/ConfirmModal.vue";
import InviteLinkRow from "~/components/library/settings/InviteLinkRow.vue";
import LibraryMemberRow from "~/components/library/settings/LibraryMemberRow.vue";

const router = useRouter();
const route = useRoute();
const libraryId = computed(() => route.params.id as string);
const { user } = useAuth();
const toast = useToast();
const { refreshLibraries } = useLibrariesList();

const { data: library, refresh: refreshLibrary } = useApiFetch<Library>(
  () => `/api/libraries/${libraryId.value}`,
);
const { data: libraryUsers, refresh: refreshLibraryUsers } = useApiFetch<LibraryUsersResponse>(
  () => `/api/libraries/${libraryId.value}/users`,
);

const {
  memberRoleDrafts,
  createInviteLinkLoading,
  updatingMemberUserId,
  removingMemberUserId,
  revokingInviteId,
  inviteRoleOptions,
  libraryMembers,
  inviteLinks,
  copyInviteLink,
  createInviteLink,
  updateMemberRole,
  removeMember,
  revokeInvite,
} = useLibraryMembers(libraryId, libraryUsers, refreshLibraryUsers);

const newLinkMaxUses = ref<string>("");
const newLinkExpiresAt = ref<string>("");

async function submitCreateInviteLink() {
  const max = newLinkMaxUses.value.trim();
  const exp = newLinkExpiresAt.value.trim();
  await createInviteLink({
    maxUses: max ? Number(max) : null,
    expiresAt: exp ? new Date(exp).toISOString() : null,
  });
  newLinkMaxUses.value = "";
  newLinkExpiresAt.value = "";
}

const fileCounts = ref<{ totalCount: number; trashedCount: number } | null>(null);

async function fetchFileCounts() {
  try {
    const [activeFiles, trashedFiles] = await Promise.all([
      api.files.list(libraryId.value, { limit: "1" }),
      api.files.list(libraryId.value, { trashed: "true", limit: "1" }),
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
watch(
  libraryId,
  () => {
    fetchFileCounts();
  },
  { immediate: true },
);

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
  await api.libraries.update(libraryId.value, { name });
  await refreshLibrary();
}

async function saveLibraryEmoji(emoji: string | null) {
  await api.libraries.update(libraryId.value, { emoji: emoji ?? "" });
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

const objDetToggling = ref(false);
const objDetDisableOpen = ref(false);
const objDetReprocessOpen = ref(false);
const objDetReprocessing = ref(false);

const videoThumbReprocessOpen = ref(false);
const videoThumbReprocessing = ref(false);

const transcribeReprocessOpen = ref(false);
const transcribeReprocessing = ref(false);

const audioDetectReprocessOpen = ref(false);
const audioDetectReprocessing = ref(false);

const sharingToggling = ref(false);
const savingLibraryName = ref(false);
const deleteLibraryOpen = ref(false);
const deleteLibraryConfirmation = ref("");
const libraryNameDraft = ref("");

watch(
  () => library.value?.name,
  (name) => {
    libraryNameDraft.value = name ?? "";
  },
  { immediate: true },
);

async function saveLibraryNameFromSettings() {
  const trimmed = libraryNameDraft.value.trim();
  if (!trimmed || trimmed === library.value?.name) return;

  savingLibraryName.value = true;
  try {
    await saveLibraryName(trimmed);
    toast.add({ title: "Library name updated", color: "success" });
  } catch {
    toast.add({ title: "Failed to update library name", color: "error" });
  } finally {
    savingLibraryName.value = false;
  }
}

async function toggleFaceRecognition(enabled: boolean) {
  if (!enabled) {
    faceRecDisableOpen.value = true;
    return;
  }

  faceRecToggling.value = true;
  try {
    await api.libraries.update(libraryId.value, { faceRecognitionEnabled: true });
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
    await api.libraries.update(libraryId.value, { faceRecognitionEnabled: false });
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
    const result = await api.people.reprocess(libraryId.value);
    toast.add({
      title: "Reprocessing queued",
      description: `${result.queuedCount} image${result.queuedCount === 1 ? "" : "s"} queued for fresh facial recognition.`,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to queue facial recognition reprocessing";
    toast.add({ title: message, color: "error" });
  } finally {
    faceRecReprocessing.value = false;
  }
}

async function toggleObjectDetection(enabled: boolean) {
  if (!enabled) {
    objDetDisableOpen.value = true;
    return;
  }

  objDetToggling.value = true;
  try {
    await api.libraries.update(libraryId.value, { objectDetectionEnabled: true });
    await refreshLibrary();
    toast.add({ title: "Object detection enabled. Processing will begin shortly." });
  } catch {
    toast.add({ title: "Failed to enable object detection", color: "error" });
  } finally {
    objDetToggling.value = false;
  }
}

async function confirmDisableObjectDetection() {
  objDetToggling.value = true;
  objDetDisableOpen.value = false;
  try {
    await api.libraries.update(libraryId.value, { objectDetectionEnabled: false });
    await refreshLibrary();
    toast.add({ title: "Object detection disabled. All detection data has been deleted." });
  } catch {
    toast.add({ title: "Failed to disable object detection", color: "error" });
  } finally {
    objDetToggling.value = false;
  }
}

async function reprocessObjectDetection() {
  objDetReprocessing.value = true;
  objDetReprocessOpen.value = false;
  try {
    const result = await api.objects.reprocess(libraryId.value);
    toast.add({
      title: "Reprocessing queued",
      description: `${result.queuedCount} image${result.queuedCount === 1 ? "" : "s"} queued for fresh object detection.`,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to queue object detection reprocessing";
    toast.add({ title: message, color: "error" });
  } finally {
    objDetReprocessing.value = false;
  }
}

// Reprocess every video/audio file in the library. Asynq dedup on the
// enqueue side prevents duplicate worker runs if the user clicks twice.
async function reprocessTranscripts() {
  transcribeReprocessing.value = true;
  transcribeReprocessOpen.value = false;
  try {
    const result = await api.files.bulkTranscribe(libraryId.value);
    const skippedCount = Object.keys(result.skipped).length;
    toast.add({
      title: "Transcription queued",
      description: `${result.enqueued.length} file${result.enqueued.length === 1 ? "" : "s"} queued${skippedCount ? `, ${skippedCount} skipped` : ""}.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to queue bulk transcription";
    toast.add({ title: message, color: "error" });
  } finally {
    transcribeReprocessing.value = false;
  }
}

async function reprocessAudioDetections() {
  audioDetectReprocessing.value = true;
  audioDetectReprocessOpen.value = false;
  try {
    const result = await api.files.bulkAudioDetect(libraryId.value);
    const skippedCount = Object.keys(result.skipped).length;
    toast.add({
      title: "Audio detection queued",
      description: `${result.enqueued.length} file${result.enqueued.length === 1 ? "" : "s"} queued${skippedCount ? `, ${skippedCount} skipped` : ""}.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to queue bulk audio detection";
    toast.add({ title: message, color: "error" });
  } finally {
    audioDetectReprocessing.value = false;
  }
}

const isLibraryOwner = computed(() => {
  return !!library.value?.ownerId && !!user.value?.id && library.value.ownerId === user.value.id;
});

async function toggleSharing(enabled: boolean) {
  sharingToggling.value = true;
  try {
    await api.libraries.update(libraryId.value, { sharingEnabled: enabled });
    await refreshLibrary();
    toast.add({
      title: enabled
        ? "Sharing enabled. Members can now create public share links."
        : "Sharing disabled. Existing links are revoked.",
      color: "success",
    });
  } catch {
    toast.add({ title: "Failed to update sharing setting", color: "error" });
  } finally {
    sharingToggling.value = false;
  }
}

async function reprocessVideoThumbnails() {
  videoThumbReprocessing.value = true;
  videoThumbReprocessOpen.value = false;
  try {
    const result = await api.files.reprocessVideoThumbnails(libraryId.value);
    toast.add({
      title: "Thumbnail regeneration queued",
      description: `${result.queuedCount} video${result.queuedCount === 1 ? "" : "s"} queued for thumbnail regeneration.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to queue thumbnail regeneration";
    toast.add({ title: message, color: "error" });
  } finally {
    videoThumbReprocessing.value = false;
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
    await api.libraries.delete(libraryId.value);
    deleteLibraryOpen.value = false;
    await refreshLibraries();
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
  <div class="space-y-4 overflow-y-auto flex-1 min-h-0 px-0.5">
    <!-- Library Name -->
    <AppPanel title="Library Name" description="Rename this library." icon="i-lucide-folder-pen">
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput
          v-model="libraryNameDraft"
          placeholder="Library name"
          :ui="{ root: 'w-full' }"
          @keydown.enter="saveLibraryNameFromSettings"
        />
        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-check"
          :loading="savingLibraryName"
          :disabled="
            savingLibraryName ||
            !libraryNameDraft.trim() ||
            libraryNameDraft.trim() === (library?.name ?? '')
          "
          @click="saveLibraryNameFromSettings"
        >
          Save
        </UButton>
      </div>
    </AppPanel>

    <!-- Library Members -->
    <AppPanel
      v-if="!library?.isDefault"
      title="Library Members"
      description="Manage who has access to this library and their permissions."
      icon="i-lucide-users"
    >
      <div class="space-y-6">
        <div class="space-y-3">
          <div>
            <p class="text-sm font-medium text-highlighted">Create Invite Link</p>
            <p class="text-xs text-muted">
              Anyone with the link can sign up and join this library as a member.
            </p>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
            <UFormField label="Max uses" class="flex-1">
              <UInput
                v-model="newLinkMaxUses"
                type="number"
                min="1"
                placeholder="Unlimited"
                class="w-full"
                :ui="{ root: 'w-full' }"
              />
            </UFormField>
            <UFormField label="Expires at" class="flex-1">
              <UInput
                v-model="newLinkExpiresAt"
                type="datetime-local"
                class="w-full"
                :ui="{ root: 'w-full' }"
              />
            </UFormField>
            <UButton
              color="primary"
              icon="i-lucide-link"
              :loading="createInviteLinkLoading"
              :disabled="createInviteLinkLoading"
              @click="submitCreateInviteLink"
            >
              Create Link
            </UButton>
          </div>
          <p class="text-xs text-muted">
            Leave both fields blank for unlimited uses that never expire.
          </p>
        </div>

        <template v-if="inviteLinks.length">
          <USeparator />
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium text-highlighted">Active Invite Links</p>
                <p class="text-xs text-muted">
                  Track redemptions and revoke links you no longer need.
                </p>
              </div>
              <UBadge color="neutral" variant="soft" size="sm">
                {{ inviteLinks.length }}
              </UBadge>
            </div>
            <div class="divide-y divide-default overflow-hidden rounded-lg border border-default">
              <InviteLinkRow
                v-for="invite in inviteLinks"
                :key="invite.id"
                :invite="invite"
                :revoking="revokingInviteId === invite.id"
                @copy="copyInviteLink"
                @revoke="revokeInvite"
              />
            </div>
          </div>
        </template>

        <template v-if="libraryMembers.length">
          <USeparator />
          <div class="space-y-3">
            <p class="text-sm font-medium text-highlighted">Members</p>
            <div class="divide-y divide-default overflow-hidden rounded-lg border border-default">
              <LibraryMemberRow
                v-for="member in libraryMembers"
                :key="member.id"
                :member="member"
                :role-draft="
                  (memberRoleDrafts[member.userId] ??
                    (member.role === 'owner' ? 'admin' : member.role)) as 'admin' | 'viewer'
                "
                :updating-role="updatingMemberUserId === member.userId"
                :removing="removingMemberUserId === member.userId"
                :role-options="inviteRoleOptions"
                @update-role="
                  (_, role) => {
                    memberRoleDrafts[member.userId] = role;
                    updateMemberRole(member);
                  }
                "
                @remove="removeMember"
              />
            </div>
          </div>
        </template>
      </div>
    </AppPanel>

    <!-- Facial Recognition -->
    <AppPanel
      title="Facial Recognition"
      description="Detect and group faces from image uploads. Disabling removes all face data."
      icon="i-lucide-scan-face"
    >
      <div class="space-y-4">
        <AppPanelRow
          title="Enable facial recognition"
          description="Process new uploads and group detected faces."
        >
          <USwitch
            :model-value="library?.faceRecognitionEnabled ?? false"
            :disabled="faceRecToggling"
            @update:model-value="toggleFaceRecognition($event as boolean)"
          />
        </AppPanelRow>

        <USeparator />

        <AppPanelRow
          title="Queue full reprocessing"
          description="Deletes current face inference data, then re-runs detection on all images."
        >
          <UButton
            color="warning"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="faceRecReprocessing"
            :disabled="!library?.faceRecognitionEnabled || faceRecToggling || faceRecReprocessing"
            @click="faceRecReprocessOpen = true"
          >
            Reprocess Faces
          </UButton>
        </AppPanelRow>
      </div>
    </AppPanel>

    <!-- Object Detection -->
    <AppPanel
      title="Object Detection"
      description="Detect objects in image uploads using YOLO26. Disabling removes all detection data."
      icon="i-lucide-scan-search"
    >
      <div class="space-y-4">
        <AppPanelRow
          title="Enable object detection"
          description="Process new uploads and index detected objects."
        >
          <USwitch
            :model-value="library?.objectDetectionEnabled ?? false"
            :disabled="objDetToggling"
            @update:model-value="toggleObjectDetection($event as boolean)"
          />
        </AppPanelRow>

        <USeparator />

        <AppPanelRow
          title="Queue full reprocessing"
          description="Deletes current object detection data, then re-runs detection on all images."
        >
          <UButton
            color="warning"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="objDetReprocessing"
            :disabled="!library?.objectDetectionEnabled || objDetToggling || objDetReprocessing"
            @click="objDetReprocessOpen = true"
          >
            Reprocess Objects
          </UButton>
        </AppPanelRow>
      </div>
    </AppPanel>

    <!-- Transcription -->
    <AppPanel
      title="Transcription"
      description="Generate searchable text + WebVTT cues from video and audio files using whisper.cpp."
      icon="i-lucide-captions"
    >
      <AppPanelRow
        title="Re-transcribe all videos"
        description="Queues transcription for every video and audio file in this library, overwriting existing transcripts. Useful after a model upgrade or hallucination-fix rollout."
      >
        <UButton
          color="warning"
          variant="soft"
          icon="i-lucide-captions"
          :loading="transcribeReprocessing"
          :disabled="transcribeReprocessing"
          @click="transcribeReprocessOpen = true"
        >
          Reprocess Transcripts
        </UButton>
      </AppPanelRow>
    </AppPanel>

    <!-- Audio Event Detection -->
    <AppPanel
      title="Audio Event Detection"
      description="Tag audio segments with PANNs CNN14 (music, speech, applause, …). Requires the file's transcript to be ready."
      icon="i-lucide-audio-waveform"
    >
      <AppPanelRow
        title="Re-run audio detection on all videos"
        description="Queues PANNs detection for every video and audio file with a ready transcript, overwriting existing audio-event tags."
      >
        <UButton
          color="warning"
          variant="soft"
          icon="i-lucide-audio-waveform"
          :loading="audioDetectReprocessing"
          :disabled="audioDetectReprocessing"
          @click="audioDetectReprocessOpen = true"
        >
          Reprocess Audio Detections
        </UButton>
      </AppPanelRow>
    </AppPanel>

    <!-- Sharing -->
    <AppPanel
      title="Sharing"
      description="Allow members to create public share links for moments in this library."
      icon="i-lucide-share-2"
    >
      <AppPanelRow
        title="Enable sharing"
        description="When on, anyone with a share link can view the individual moment without signing in."
      >
        <USwitch
          :model-value="library?.sharingEnabled ?? false"
          :disabled="sharingToggling"
          @update:model-value="toggleSharing($event as boolean)"
        />
      </AppPanelRow>
    </AppPanel>

    <!-- Video Thumbnails -->
    <AppPanel
      v-if="isLibraryOwner"
      title="Video Thumbnails"
      description="Regenerate JPG thumbnails for all source videos in this library."
      icon="i-lucide-image-up"
    >
      <div class="flex sm:justify-end">
        <UButton
          color="warning"
          variant="soft"
          icon="i-lucide-image-up"
          :loading="videoThumbReprocessing"
          :disabled="videoThumbReprocessing"
          @click="videoThumbReprocessOpen = true"
        >
          Regenerate Thumbnails
        </UButton>
      </div>
    </AppPanel>

    <!-- Danger Zone -->
    <AppPanel>
      <template #title>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 text-error" />
          <h2 class="text-sm font-semibold text-error">Delete Library</h2>
        </div>
      </template>
      <AppPanelRow
        title="Delete this library"
        description="Permanently remove this library. Must be empty first."
        danger
      >
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          :disabled="!canDeleteLibrary"
          @click="deleteLibraryOpen = true"
        >
          Delete
        </UButton>
      </AppPanelRow>
    </AppPanel>

    <ConfirmModal
      v-model:open="faceRecDisableOpen"
      title="Disable Facial Recognition"
      message="This will permanently delete all detected faces and people data for this library. This action cannot be undone."
      confirm-label="Disable & Delete Data"
      confirm-class="btn-soft btn-error"
      confirm-icon="i-lucide-trash-2"
      :pending="faceRecToggling"
      @confirm="confirmDisableFaceRecognition"
    />

    <ConfirmModal
      v-model:open="videoThumbReprocessOpen"
      title="Regenerate Video Thumbnails"
      message="This queues thumbnail regeneration for all source videos in this library. Existing generated thumbnails will be replaced as new ones complete."
      confirm-label="Queue Regeneration"
      confirm-class="btn-soft btn-warning"
      confirm-icon="i-lucide-image-up"
      :pending="videoThumbReprocessing"
      @confirm="reprocessVideoThumbnails"
    />

    <ConfirmModal
      v-model:open="faceRecReprocessOpen"
      title="Reprocess Facial Recognition"
      message="This deletes all existing face inference data and queues a full rebuild. Results may change, including how photos are grouped into people."
      confirm-label="Delete Data & Requeue"
      confirm-class="btn-soft btn-warning"
      confirm-icon="i-lucide-refresh-cw"
      :pending="faceRecReprocessing"
      @confirm="reprocessFaceRecognition"
    />

    <ConfirmModal
      v-model:open="transcribeReprocessOpen"
      title="Reprocess Transcripts"
      message="This queues transcription for every video and audio file in the library. Existing transcripts will be overwritten when each job completes."
      confirm-label="Queue Reprocessing"
      confirm-class="btn-soft btn-warning"
      confirm-icon="i-lucide-captions"
      :pending="transcribeReprocessing"
      @confirm="reprocessTranscripts"
    />

    <ConfirmModal
      v-model:open="audioDetectReprocessOpen"
      title="Reprocess Audio Detections"
      message="This queues PANNs audio-event detection for every video and audio file with a ready transcript. Existing audio-event tags will be overwritten when each job completes."
      confirm-label="Queue Reprocessing"
      confirm-class="btn-soft btn-warning"
      confirm-icon="i-lucide-audio-waveform"
      :pending="audioDetectReprocessing"
      @confirm="reprocessAudioDetections"
    />

    <!-- Disable Object Detection Modal -->
    <UModal
      v-model:open="objDetDisableOpen"
      title="Disable Object Detection"
      description="This will permanently delete all detected object data for this library. This action cannot be undone."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="objDetToggling"
            @click="objDetDisableOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="objDetToggling"
            :disabled="objDetToggling"
            @click="confirmDisableObjectDetection"
          >
            Disable & Delete Data
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Reprocess Object Detection Modal -->
    <UModal
      v-model:open="objDetReprocessOpen"
      title="Reprocess Object Detection"
      description="This deletes all existing object detection data and queues a full rebuild. Detected objects may change if the model or settings have been updated."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="objDetReprocessing"
            @click="objDetReprocessOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            color="warning"
            icon="i-lucide-refresh-cw"
            :loading="objDetReprocessing"
            :disabled="objDetReprocessing"
            @click="reprocessObjectDetection"
          >
            Delete Data & Requeue
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Delete Library Modal -->
    <UModal
      v-model:open="deleteLibraryOpen"
      title="Delete Library"
      :description="`This will permanently delete the library ${library?.name ?? ''}. This action cannot be undone.`"
    >
      <template #body>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Type 'delete' to confirm</label>
          <UInput
            v-model="deleteLibraryConfirmation"
            placeholder="delete"
            :ui="{ root: 'w-full' }"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="soft" @click="deleteLibraryOpen = false">
            Cancel
          </UButton>
          <UButton
            color="error"
            variant="soft"
            icon="i-lucide-trash-2"
            :disabled="deleteLibraryConfirmation !== 'delete'"
            @click="deleteLibrary"
          >
            Delete Library
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
