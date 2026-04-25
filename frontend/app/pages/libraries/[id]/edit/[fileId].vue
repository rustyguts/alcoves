<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useApiFetch } from "~/composables/useApiFetch";

definePageMeta({ layout: "dashboard" });

import { useLibraryMoments } from "~/composables/useLibraryMoments";
import { useToast } from "~/composables/useToast";
import { api } from "~/api";
import VideoEditorPlayer from "~/components/editor/VideoEditorPlayer.vue";
import MomentTimeline from "~/components/editor/MomentTimeline.vue";
import MomentEditForm from "~/components/editor/MomentEditForm.vue";
import EditorSidebar from "~/components/editor/EditorSidebar.vue";
import EditorKeyboardHelpModal from "~/components/editor/EditorKeyboardHelpModal.vue";
import AudioDetectionsPanel from "~/components/editor/AudioDetectionsPanel.vue";
import HighlightFiltersPanel from "~/components/editor/HighlightFiltersPanel.vue";
import TranscriptPanel from "~/components/editor/TranscriptPanel.vue";
import { parseVtt, type VttCue } from "~/utils/parse-vtt";
import {
  useHighlightFilters,
  useHighlightMatches,
} from "~/composables/useHighlightFilters";
import type {
  HighlightFilterCreate,
  HighlightFilterPatch,
} from "~~/shared/types/api";
import MomentShareModal from "~/components/editor/MomentShareModal.vue";
import ConfirmModal from "~/components/ConfirmModal.vue";
import type { AudioDetection, Library, LibraryFile, Moment } from "~~/shared/types/api";

const route = useRoute();
const router = useRouter();
const toast = useToast();

const libraryId = computed(() => route.params.id as string);
const fileId = computed(() => route.params.fileId as string);

const { data: library } = useApiFetch<Library>(() => `/api/libraries/${libraryId.value}`);
const { data: file } = useApiFetch<LibraryFile>(
  () => `/api/libraries/${libraryId.value}/files/${fileId.value}`,
);

const {
  moments,
  refresh: refreshMoments,
  create: createMoment,
  update: updateMoment,
  remove: removeMoment,
  triggerExport,
} = useLibraryMoments(libraryId, fileId);

const playerRef = ref<InstanceType<typeof VideoEditorPlayer> | null>(null);
const currentTime = ref(0);
const duration = ref(0);
const selectedId = ref<string | null>(null);
const pendingDeleteId = ref<string | null>(null);
const saving = ref(false);
const shortcutsOpen = ref(false);
const pendingDownloadIds = ref(new Set<string>());
const transcribing = ref(false);
let transcribePollTimer: ReturnType<typeof setInterval> | null = null;

const audioDetecting = ref(false);
const audioDetections = ref<AudioDetection[]>([]);
let audioDetectPollTimer: ReturnType<typeof setInterval> | null = null;

async function refreshAudioDetections() {
  try {
    const list = await api.files.audioDetections(libraryId.value, fileId.value);
    audioDetections.value = list ?? [];
  } catch {
    audioDetections.value = [];
  }
}

function stopAudioDetectPolling() {
  if (audioDetectPollTimer) {
    clearInterval(audioDetectPollTimer);
    audioDetectPollTimer = null;
  }
}

function startAudioDetectPolling() {
  if (audioDetectPollTimer) return;
  audioDetectPollTimer = setInterval(() => {
    void refreshFile();
  }, 2000);
}

async function onAudioDetect() {
  audioDetecting.value = true;
  try {
    const updated = await api.files.audioDetect(libraryId.value, fileId.value);
    file.value = updated;
    toast.add({ title: "Audio detection queued", color: "info" });
    startAudioDetectPolling();
  } catch {
    toast.add({ title: "Failed to queue audio detection", color: "error" });
  } finally {
    audioDetecting.value = false;
  }
}

watch(
  () => file.value?.audioDetectStatus,
  (status) => {
    if (status === "queued" || status === "processing") {
      startAudioDetectPolling();
    } else {
      stopAudioDetectPolling();
      if (status === "ready") {
        void refreshAudioDetections();
        toast.add({ title: "Audio detection ready", color: "success" });
      } else if (status === "failed") {
        toast.add({
          title: "Audio detection failed",
          description: file.value?.audioDetectError ?? undefined,
          color: "error",
        });
      }
    }
  },
);

watch(
  () => file.value?.id,
  (id) => {
    if (id) void refreshAudioDetections();
  },
  { immediate: true },
);

// ── Highlight filters (per-library, server-persisted) ─────
const transcriptVtt = ref<string | null>(null);

async function refreshTranscript() {
  if (!file.value || file.value.transcribeStatus !== "ready") {
    transcriptVtt.value = null;
    return;
  }
  try {
    const r = await api.files.transcript(libraryId.value, fileId.value);
    transcriptVtt.value = r?.vtt ?? null;
  } catch {
    transcriptVtt.value = null;
  }
}

watch(
  () => file.value?.transcribeStatus,
  (status) => {
    if (status === "ready") void refreshTranscript();
    else transcriptVtt.value = null;
  },
  { immediate: true },
);

const transcriptCues = computed<VttCue[]>(() => parseVtt(transcriptVtt.value));

const {
  filters: highlightFilters,
  loading: highlightFiltersLoading,
  refresh: refreshHighlightFilters,
  create: createHighlightFilter,
  update: updateHighlightFilter,
  remove: removeHighlightFilter,
  loadPresets: loadHighlightPresets,
} = useHighlightFilters(libraryId);

void refreshHighlightFilters();

const { matches: highlightMatches, aggregates: highlightAggregates } = useHighlightMatches(
  highlightFilters,
  audioDetections,
  transcriptVtt,
);

const hasHighlightSignals = computed(
  () => audioDetections.value.length > 0 || (transcriptVtt.value?.length ?? 0) > 0,
);

async function onHighlightCreate(body: HighlightFilterCreate) {
  try {
    await createHighlightFilter(body);
    toast.add({ title: `Filter "${body.name}" added`, color: "success" });
  } catch {
    toast.add({ title: "Failed to add filter", color: "error" });
  }
}

async function onHighlightUpdate(id: string, body: HighlightFilterPatch) {
  try {
    await updateHighlightFilter(id, body);
  } catch {
    toast.add({ title: "Failed to update filter", color: "error" });
  }
}

async function onHighlightRemove(id: string) {
  try {
    await removeHighlightFilter(id);
  } catch {
    toast.add({ title: "Failed to delete filter", color: "error" });
  }
}

async function onHighlightLoadPresets() {
  try {
    await loadHighlightPresets();
    toast.add({ title: "Presets loaded", color: "success" });
  } catch {
    toast.add({ title: "Failed to load presets", color: "error" });
  }
}

const audioDetectButton = computed(() => {
  const s = file.value?.audioDetectStatus ?? null;
  const progress = file.value?.audioDetectProgress ?? null;
  if (s === "processing" || s === "queued") {
    return {
      label: progress != null ? `Detecting ${progress}%` : "Detecting…",
      color: "warning" as const,
      loading: true,
      disabled: true,
    };
  }
  if (s === "failed") {
    return {
      label: "Retry detect",
      color: "error" as const,
      loading: false,
      disabled: false,
    };
  }
  if (s === "ready") {
    return {
      label: "Redetect",
      color: "neutral" as const,
      loading: false,
      disabled: false,
    };
  }
  return {
    label: "Detect sounds",
    color: "primary" as const,
    loading: false,
    disabled: false,
  };
});

const canDetectAudio = computed(() => file.value?.transcribeStatus === "ready");

async function refreshFile() {
  try {
    const latest = await api.files.get(libraryId.value, fileId.value);
    file.value = latest;
  } catch {
    /* ignore */
  }
}

function stopTranscribePolling() {
  if (transcribePollTimer) {
    clearInterval(transcribePollTimer);
    transcribePollTimer = null;
  }
}

function startTranscribePolling() {
  if (transcribePollTimer) return;
  transcribePollTimer = setInterval(() => {
    void refreshFile();
  }, 2000);
}

async function onTranscribe() {
  transcribing.value = true;
  try {
    const updated = await api.files.transcribe(libraryId.value, fileId.value);
    file.value = updated;
    toast.add({ title: "Transcription queued", color: "info" });
    startTranscribePolling();
  } catch {
    toast.add({ title: "Failed to queue transcription", color: "error" });
  } finally {
    transcribing.value = false;
  }
}

watch(
  () => file.value?.transcribeStatus,
  (status) => {
    if (status === "queued" || status === "processing") {
      startTranscribePolling();
    } else {
      stopTranscribePolling();
      if (status === "ready") {
        toast.add({ title: "Transcription ready", color: "success" });
      } else if (status === "failed") {
        toast.add({
          title: "Transcription failed",
          description: file.value?.transcribeError ?? undefined,
          color: "error",
        });
      }
    }
  },
);

const transcribeButton = computed(() => {
  const s = file.value?.transcribeStatus ?? null;
  const progress = file.value?.transcribeProgress ?? null;
  if (s === "processing" || s === "queued") {
    return {
      label: progress != null ? `Transcribing ${progress}%` : "Transcribing…",
      color: "warning" as const,
      loading: true,
      disabled: true,
    };
  }
  if (s === "failed") {
    return {
      label: "Retry transcribe",
      color: "error" as const,
      loading: false,
      disabled: false,
    };
  }
  if (s === "ready") {
    return {
      label: "Retranscribe",
      color: "neutral" as const,
      loading: false,
      disabled: false,
    };
  }
  return {
    label: "Transcribe",
    color: "primary" as const,
    loading: false,
    disabled: false,
  };
});

const selectedMoment = computed<Moment | null>(
  () => moments.value.find((m) => m.id === selectedId.value) ?? null,
);

const activeMoment = computed<Moment | null>(
  () =>
    moments.value.find(
      (m) => currentTime.value >= m.startSeconds && currentTime.value <= m.endSeconds,
    ) ?? null,
);

function goBack() {
  router.push(`/libraries/${libraryId.value}`);
}

async function createAtPlayhead() {
  const start = currentTime.value;
  const end = Math.min(duration.value || start + 5, start + 5);
  try {
    const created = await createMoment({
      name: "",
      description: "",
      startSeconds: start,
      endSeconds: end,
    });
    selectedId.value = created.id;
    toast.add({ title: "Moment created", color: "success" });
  } catch {
    toast.add({ title: "Failed to create moment", color: "error" });
  }
}

async function onSaveForm(patch: {
  name: string;
  description: string;
  startSeconds: number;
  endSeconds: number;
}) {
  if (!selectedMoment.value) return;
  saving.value = true;
  try {
    await updateMoment(selectedMoment.value.id, patch);
    toast.add({ title: "Moment saved", color: "success" });
  } catch {
    toast.add({ title: "Failed to save moment", color: "error" });
  } finally {
    saving.value = false;
  }
}

function onSetPlayhead(field: "start" | "end") {
  if (!selectedMoment.value) return;
  const patch =
    field === "start"
      ? { startSeconds: currentTime.value }
      : { endSeconds: currentTime.value };
  void updateMoment(selectedMoment.value.id, patch);
}

async function onExport(momentId: string) {
  try {
    await triggerExport(momentId);
    toast.add({ title: "Export queued", color: "success" });
  } catch {
    toast.add({ title: "Failed to queue export", color: "error" });
  }
}

async function onSavePending(
  changes: Array<{ id: string; startSeconds: number; endSeconds: number }>,
) {
  if (changes.length === 0) return;
  try {
    await Promise.all(
      changes.map((c) =>
        updateMoment(c.id, { startSeconds: c.startSeconds, endSeconds: c.endSeconds }),
      ),
    );
    toast.add({ title: `Saved ${changes.length} moment(s)`, color: "success" });
    await Promise.allSettled(changes.map((c) => triggerExport(c.id)));
  } catch {
    toast.add({ title: "Failed to save changes", color: "error" });
  }
}

function isMomentReady(m: Moment): boolean {
  return m.exportStatus === "ready" && m.exportedVersion === m.exportVersion;
}

async function onDownload(momentId: string) {
  const m = moments.value.find((x) => x.id === momentId);
  if (!m) return;
  if (isMomentReady(m)) {
    window.location.href = api.moments.downloadUrl(libraryId.value, fileId.value, momentId);
    return;
  }
  pendingDownloadIds.value = new Set([...pendingDownloadIds.value, momentId]);
  try {
    await triggerExport(momentId);
    toast.add({ title: "Processing clip…", color: "info" });
  } catch {
    const next = new Set(pendingDownloadIds.value);
    next.delete(momentId);
    pendingDownloadIds.value = next;
    toast.add({ title: "Failed to start export", color: "error" });
  }
}

watch(
  moments,
  (list) => {
    if (pendingDownloadIds.value.size === 0) return;
    const next = new Set(pendingDownloadIds.value);
    let changed = false;
    for (const id of [...pendingDownloadIds.value]) {
      const m = list.find((x) => x.id === id);
      if (!m) {
        next.delete(id);
        changed = true;
        continue;
      }
      if (isMomentReady(m)) {
        next.delete(id);
        changed = true;
        window.location.href = api.moments.downloadUrl(libraryId.value, fileId.value, id);
      } else if (m.exportStatus === "failed") {
        next.delete(id);
        changed = true;
        toast.add({ title: "Export failed", color: "error" });
      }
    }
    if (changed) pendingDownloadIds.value = next;
  },
  { deep: true },
);

const shareMomentId = ref<string | null>(null);
const shareOpen = computed({
  get: () => shareMomentId.value !== null,
  set: (v) => {
    if (!v) shareMomentId.value = null;
  },
});

function onShare(momentId: string) {
  if (!library.value?.sharingEnabled) {
    toast.add({
      title: "Sharing is disabled for this library",
      description: "Enable it in library settings to create share links.",
      color: "warning",
    });
    return;
  }
  shareMomentId.value = momentId;
}

function onDeleteRequest(momentId: string) {
  pendingDeleteId.value = momentId;
}

async function onDeleteConfirm() {
  const id = pendingDeleteId.value;
  if (!id) return;
  pendingDeleteId.value = null;
  try {
    await removeMoment(id);
    if (selectedId.value === id) selectedId.value = null;
    toast.add({ title: "Moment deleted", color: "success" });
  } catch {
    toast.add({ title: "Failed to delete moment", color: "error" });
  }
}

function onSeek(seconds: number) {
  playerRef.value?.seek(seconds);
}

// Keyboard shortcuts: I sets selected moment's start to playhead, O sets end,
// M creates a new 5s moment at playhead, Space toggles play.
function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target && /input|textarea|select/i.test(target.tagName)) return;
  if (e.key === "i" || e.key === "I") {
    if (selectedMoment.value) onSetPlayhead("start");
    e.preventDefault();
  } else if (e.key === "o" || e.key === "O") {
    if (selectedMoment.value) onSetPlayhead("end");
    e.preventDefault();
  } else if (e.key === "m" || e.key === "M") {
    void createAtPlayhead();
    e.preventDefault();
  } else if (e.key === " ") {
    playerRef.value?.togglePlay();
    e.preventDefault();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  stopTranscribePolling();
  stopAudioDetectPolling();
});

void refreshMoments;
</script>

<template>
  <div class="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
    <div class="flex items-center gap-3 w-full">
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        @click="goBack"
      >
        Back
      </UButton>
      <div class="min-w-0 flex-1">
        <p class="text-lg font-semibold truncate">{{ file?.name ?? "Loading…" }}</p>
        <p class="text-xs text-muted">
          {{ library?.name ?? "Library" }} · Editor ·
          <span v-if="duration">{{ duration.toFixed(1) }}s</span>
        </p>
      </div>
      <UButton
        v-if="file && (file.mimeType?.startsWith('video/') || file.mimeType?.startsWith('audio/'))"
        :color="transcribeButton.color"
        :variant="file?.transcribeStatus === 'failed' ? 'solid' : 'soft'"
        size="sm"
        icon="i-lucide-captions"
        :loading="transcribeButton.loading || transcribing"
        :disabled="transcribeButton.disabled || transcribing"
        @click="onTranscribe"
      >
        {{ transcribeButton.label }}
      </UButton>
      <UButton
        v-if="canDetectAudio"
        :color="audioDetectButton.color"
        :variant="file?.audioDetectStatus === 'failed' ? 'solid' : 'soft'"
        size="sm"
        icon="i-lucide-audio-lines"
        :loading="audioDetectButton.loading || audioDetecting"
        :disabled="audioDetectButton.disabled || audioDetecting"
        @click="onAudioDetect"
      >
        {{ audioDetectButton.label }}
      </UButton>
    </div>

    <div class="flex flex-1 min-h-0 gap-4 overflow-hidden">
      <div class="flex flex-col gap-4 flex-1 min-w-0 overflow-y-auto">
        <VideoEditorPlayer
          v-if="file"
          ref="playerRef"
          :file="file"
          :library-id="libraryId"
          :active="activeMoment !== null"
          @update:current-time="currentTime = $event"
          @update:duration="duration = $event"
        />

        <MomentTimeline
          :duration="duration"
          :current-time="currentTime"
          :moments="moments"
          :selected-id="selectedId"
          @seek="onSeek"
          @select-moment="selectedId = $event"
          @save-pending="onSavePending"
          @create-moment="createAtPlayhead"
          @open-shortcuts="shortcutsOpen = true"
        />

        <MomentEditForm
          v-if="selectedMoment"
          :moment="selectedMoment"
          :current-time="currentTime"
          :duration="duration"
          :download-pending="pendingDownloadIds.has(selectedMoment.id)"
          @save="onSaveForm"
          @set-to-playhead="onSetPlayhead"
          @delete="onDeleteRequest"
          @close="selectedId = null"
          @export="onExport"
          @download="onDownload"
          @share="onShare"
        />

        <HighlightFiltersPanel
          :filters="highlightFilters"
          :matches="highlightMatches"
          :aggregates="highlightAggregates"
          :loading="highlightFiltersLoading"
          :has-signals="hasHighlightSignals"
          @seek="onSeek"
          @create="onHighlightCreate"
          @update="(id, body) => onHighlightUpdate(id, body)"
          @remove="onHighlightRemove"
          @load-presets="onHighlightLoadPresets"
        />

        <TranscriptPanel
          :cues="transcriptCues"
          :current-time="currentTime"
          @seek="onSeek"
        />

        <AudioDetectionsPanel
          :detections="audioDetections"
          :duration="duration"
          @seek="onSeek"
        />
      </div>

      <EditorSidebar
        :moments="moments"
        :selected-id="selectedId"
        @select="selectedId = $event"
      />
    </div>

    <MomentShareModal
      :open="shareOpen"
      :library-id="libraryId"
      :file-id="fileId"
      :moment-id="shareMomentId"
      :sharing-enabled="library?.sharingEnabled ?? false"
      @update:open="(v) => (shareOpen = v)"
    />

    <EditorKeyboardHelpModal v-model:open="shortcutsOpen" />

    <ConfirmModal
      :open="pendingDeleteId !== null"
      title="Delete moment?"
      message="This moment will be moved to trash. Any cached exports will be deleted."
      confirm-label="Delete"
      confirm-class="btn-error"
      confirm-icon="i-lucide-trash-2"
      @update:open="(v) => (pendingDeleteId = v ? pendingDeleteId : null)"
      @confirm="onDeleteConfirm"
    />
  </div>
</template>
