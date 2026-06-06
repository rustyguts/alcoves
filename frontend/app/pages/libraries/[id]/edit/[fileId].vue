<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { ref, computed } from "vue";
import { useApiFetch } from "~/composables/useApiFetch";

definePageMeta({ layout: "dashboard" });

import { useLibraryMoments } from "~/composables/useLibraryMoments";
import { useToast } from "~/composables/useToast";
import { useTranscript } from "~/composables/useTranscript";
import { useAudioDetections } from "~/composables/useAudioDetections";
import { useTranscribeJob } from "~/composables/useTranscribeJob";
import { useAudioDetectJob } from "~/composables/useAudioDetectJob";
import { useWaveform } from "~/composables/useWaveform";
import { useWaveformJob } from "~/composables/useWaveformJob";
import { useEditorHighlights } from "~/composables/useEditorHighlights";
import { useMomentDownloads } from "~/composables/useMomentDownloads";
import { useEditorShortcuts } from "~/composables/useEditorShortcuts";
import { api } from "~/api";

import VideoEditorPlayer from "~/components/editor/VideoEditorPlayer.vue";
import MomentTimeline from "~/components/editor/MomentTimeline.vue";
import MomentEditForm from "~/components/editor/MomentEditForm.vue";
import MomentsList from "~/components/editor/MomentsList.vue";
import EditorHeader from "~/components/editor/EditorHeader.vue";
import EditorKeyboardHelpModal from "~/components/editor/EditorKeyboardHelpModal.vue";
import AudioDetectionsPanel from "~/components/editor/AudioDetectionsPanel.vue";
import HighlightFiltersPanel from "~/components/editor/HighlightFiltersPanel.vue";
import TranscriptPanel from "~/components/editor/TranscriptPanel.vue";
import MomentShareModal from "~/components/editor/MomentShareModal.vue";
import ConfirmModal from "~/components/ConfirmModal.vue";

import type { Library, LibraryFile, Moment } from "~~/shared/types/api";

const route = useRoute();
const router = useRouter();
const toast = useToast();

const libraryId = computed(() => route.params.id as string);
const fileId = computed(() => route.params.fileId as string);

const { data: library } = useApiFetch<Library>(() => `/api/libraries/${libraryId.value}`);
const { data: file } = useApiFetch<LibraryFile>(
  () => `/api/libraries/${libraryId.value}/files/${fileId.value}`,
);

async function refreshFile() {
  try {
    file.value = await api.files.get(libraryId.value, fileId.value);
  } catch {
    /* ignore */
  }
}

const {
  moments,
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

const { detections: audioDetections, refresh: refreshAudioDetections } = useAudioDetections(
  libraryId,
  fileId,
  file,
);
const { vtt: transcriptVtt, cues: transcriptCues } = useTranscript(libraryId, fileId, file);

const {
  transcribing,
  button: transcribeButton,
  run: onTranscribe,
} = useTranscribeJob(libraryId, fileId, file, refreshFile);
const {
  detecting: audioDetecting,
  button: audioDetectButton,
  run: onAudioDetect,
} = useAudioDetectJob(libraryId, fileId, file, refreshFile, refreshAudioDetections);

const { peaks: waveformPeaks, peaksPerSecond: waveformPeaksPerSecond } = useWaveform(
  libraryId,
  fileId,
  file,
);
const {
  generating: waveformGenerating,
  button: waveformButton,
  run: onWaveform,
} = useWaveformJob(libraryId, fileId, file, refreshFile);

const canDetectAudio = computed(() => file.value?.transcribeStatus === "ready");

const {
  filters: highlightFilters,
  loading: highlightFiltersLoading,
  matches: highlightMatches,
  aggregates: highlightAggregates,
  hasSignals: hasHighlightSignals,
  onCreate: onHighlightCreate,
  onUpdate: onHighlightUpdate,
  onRemove: onHighlightRemove,
  onLoadPresets: onHighlightLoadPresets,
} = useEditorHighlights(libraryId, audioDetections, transcriptVtt);

const { isPending: isDownloadPending, request: requestDownload } = useMomentDownloads(
  libraryId,
  fileId,
  moments,
  triggerExport,
);

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
  // The library page sets `?from=<folderId>` when the user opens the
  // editor from inside a folder. Restore that folder on the way back so
  // they don't land at the library root and have to re-navigate.
  const from = route.query.from;
  const folderId = typeof from === "string" && from.length > 0 ? from : null;
  router.push({
    path: `/libraries/${libraryId.value}`,
    query: folderId ? { folder: folderId } : {},
  });
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
    field === "start" ? { startSeconds: currentTime.value } : { endSeconds: currentTime.value };
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

useEditorShortcuts({
  hasSelection: computed(() => selectedMoment.value !== null),
  onSetStart: () => onSetPlayhead("start"),
  onSetEnd: () => onSetPlayhead("end"),
  onCreate: () => void createAtPlayhead(),
  onTogglePlay: () => playerRef.value?.togglePlay(),
});
</script>

<template>
  <div class="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
    <EditorHeader
      :file="file"
      :transcribing="transcribing"
      :transcribe-button="transcribeButton"
      :audio-detecting="audioDetecting"
      :audio-detect-button="audioDetectButton"
      :can-detect-audio="canDetectAudio"
      :waveform-generating="waveformGenerating"
      :waveform-button="waveformButton"
      @back="goBack"
      @transcribe="onTranscribe"
      @audio-detect="onAudioDetect"
      @waveform="onWaveform"
    />

    <!--
      Editor layout grid. Two columns at lg+: video on the left half,
      moments list on the right half. Below, every other panel
      (timeline, edit form, highlight filters, transcript, audio events)
      spans both columns at full width. On mobile the grid collapses to
      one column and everything stacks with video on top.
    -->
    <div class="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 flex-1 min-h-0 overflow-y-auto content-start px-0.5">
      <!--
        Row 1 cells get a defined height so the video player and
        moments list have something to fill. h-[60svh] on mobile is
        comfortable; desktop matches. The video frame then uses a
        ResizeObserver inside this cell to compute the largest 16:9
        rectangle that fits without clipping.
      -->
      <VideoEditorPlayer
        v-if="file"
        ref="playerRef"
        class="h-[60svh] min-h-[260px] max-h-[600px]"
        :file="file"
        :library-id="libraryId"
        :active="activeMoment !== null"
        @update:current-time="currentTime = $event"
        @update:duration="duration = $event"
      />

      <MomentsList
        class="h-[60svh] min-h-[260px] max-h-[600px]"
        :moments="moments"
        :selected-id="selectedId"
        @select="selectedId = $event"
      />

      <!--
        All panels below row 1 stack flush with no extra gap. Wrapping
        them in a single lg:col-span-2 flex-col stops `gap-4` on the
        outer grid from inserting space between them, while preserving
        the gap above (between video/moments row and this stack).
      -->
      <div class="lg:col-span-2 flex flex-col gap-4">
        <MomentTimeline
          :duration="duration"
          :current-time="currentTime"
          :moments="moments"
          :selected-id="selectedId"
          :waveform-peaks="waveformPeaks"
          :waveform-peaks-per-second="waveformPeaksPerSecond"
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
          :download-pending="isDownloadPending(selectedMoment.id)"
          @save="onSaveForm"
          @set-to-playhead="onSetPlayhead"
          @delete="onDeleteRequest"
          @close="selectedId = null"
          @export="onExport"
          @download="requestDownload"
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

        <TranscriptPanel :cues="transcriptCues" :current-time="currentTime" @seek="onSeek" />

        <AudioDetectionsPanel
          :detections="audioDetections"
          :duration="duration"
          @seek="onSeek"
        />
      </div>
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
      :confirm-icon="ICONS.trash"
      @update:open="(v) => (pendingDeleteId = v ? pendingDeleteId : null)"
      @confirm="onDeleteConfirm"
    />
  </div>
</template>
