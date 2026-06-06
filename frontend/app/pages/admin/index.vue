<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import { formatFileSize } from "~/utils/mime-icons";
import { useToast } from "~/composables/useToast";
import AdminJobsPanel from "~/components/admin/AdminJobsPanel.vue";
import UserAvatar from "~/components/UserAvatar.vue";
import type { AdminStats, AdminUser, AppSettings, RegistrationMode } from "~~/shared/types/api";
import type { TableColumn } from "@nuxt/ui";
import { h, resolveComponent } from "vue";

definePageMeta({ layout: "dashboard" });

const toast = useToast();
const { user: currentUser } = useAuth();

const { data: stats } = useApiFetch<AdminStats>("/api/admin/stats");
const { data: users, status: usersStatus } = useApiFetch<AdminUser[]>("/api/admin/users");
const { data: settings } = useApiFetch<AppSettings>("/api/admin/settings");

const registrationModeDraft = ref<RegistrationMode | null>(null);
watchEffect(() => {
  if (settings.value && registrationModeDraft.value === null) {
    registrationModeDraft.value = settings.value.registration_mode;
  }
});

const registrationModes: { value: RegistrationMode; label: string; description: string }[] = [
  { value: "open", label: "Open", description: "Anyone can create an account." },
  {
    value: "invite_only",
    label: "Invite only",
    description: "Registration requires a library invite link.",
  },
  {
    value: "closed",
    label: "Closed",
    description: "Nobody can create an account. Library invites are disabled.",
  },
];

// ─── Inference model catalogs ──────────────────────────────────────────
// Static metadata for the admin selectors. The backend enforces the
// allow-list (see backend/internal/services/transcribe/whisper_models.go
// and backend/internal/services/audiodetection/registry.go); these
// dictionaries only drive the descriptions / RAM callouts in the UI. If
// the lists drift, the backend rejects unknown IDs and the admin sees a
// toast — but keep them in sync to avoid that friction.

interface WhisperModelOption {
  id: string;
  label: string;
  diskMB: number;
  ramPeakMB: number;
  realtime: number; // x-realtime factor on CPU
  werClean: number; // LibriSpeech test-clean WER %
  werOther: number;
  english: boolean;
  notes: string;
}

const whisperModels: WhisperModelOption[] = [
  { id: "tiny", label: "tiny", diskMB: 75, ramPeakMB: 390, realtime: 50, werClean: 7.5, werOther: 16, english: false, notes: "Fastest, weak accuracy." },
  { id: "base", label: "base", diskMB: 142, ramPeakMB: 500, realtime: 32, werClean: 5.0, werOther: 12, english: false, notes: "Fast fallback for low-RAM hosts." },
  { id: "small", label: "small", diskMB: 466, ramPeakMB: 1000, realtime: 16, werClean: 3.4, werOther: 7.6, english: false, notes: "Mid-tier." },
  { id: "medium", label: "medium", diskMB: 1500, ramPeakMB: 2500, realtime: 6, werClean: 3.0, werOther: 6.0, english: false, notes: "Strong accuracy within homelab memory limits." },
  { id: "large-v3", label: "large-v3 (default)", diskMB: 3100, ramPeakMB: 3900, realtime: 1, werClean: 2.7, werOther: 5.2, english: false, notes: "Best WER; ≥4 GB RAM recommended." },
  { id: "large-v3-q5_0", label: "large-v3 q5_0", diskMB: 1080, ramPeakMB: 1300, realtime: 3, werClean: 2.9, werOther: 5.4, english: false, notes: "Quantized; reasonable accuracy/size tradeoff." },
  { id: "large-v3-turbo-q5_0", label: "large-v3-turbo q5_0", diskMB: 574, ramPeakMB: 900, realtime: 10, werClean: 3.0, werOther: 5.5, english: false, notes: "8× faster than v3, near-v3 WER." },
  { id: "large-v3-turbo-q4_0", label: "large-v3-turbo q4_0", diskMB: 470, ramPeakMB: 800, realtime: 12, werClean: 3.2, werOther: 5.8, english: false, notes: "Smallest near-SOTA option." },
  { id: "distil-large-v3.5-q5", label: "distil-large-v3.5 q5 (EN)", diskMB: 600, ramPeakMB: 1000, realtime: 15, werClean: 3.0, werOther: 5.6, english: true, notes: "English-only; faster than turbo." },
];

const whisperLanguages: { id: string; label: string }[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "es", label: "Spanish" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "nl", label: "Dutch" },
  { id: "ja", label: "Japanese" },
  { id: "zh", label: "Chinese" },
  { id: "ko", label: "Korean" },
  { id: "ru", label: "Russian" },
];

interface AudioTaggerOption {
  id: string;
  label: string;
  diskMB: number;
  ramPeakMB: number;
  mAP: number;
  license: string;
  notes: string;
  // available mirrors audiodetection.ModelSpec.Available on the backend: a
  // model is only selectable once its ONNX artifact is published to the model
  // bucket. Unpublished entries stay listed (disabled) so the roadmap is
  // visible, but picking one would 404 the worker — the backend rejects it too.
  available: boolean;
}

const audioTaggers: AudioTaggerOption[] = [
  { id: "efficientat_mn04", label: "EfficientAT mn04_as (tiny)", diskMB: 5, ramPeakMB: 60, mAP: 0.432, license: "MIT", notes: "Same mAP as CNN14 at ~80× smaller. Best for ultra-constrained pods.", available: false },
  { id: "efficientat_mn10", label: "EfficientAT mn10_as (default)", diskMB: 20, ramPeakMB: 120, mAP: 0.471, license: "MIT", notes: "~16× smaller than CNN14, +9% mAP, faster on CPU.", available: true },
  { id: "efficientat_mn40", label: "EfficientAT mn40_as_ext", diskMB: 280, ramPeakMB: 500, mAP: 0.487, license: "MIT", notes: "Same disk class as CNN14, +5.6 mAP. Slower CPU inference.", available: false },
  { id: "ced_tiny", label: "CED-Tiny", diskMB: 22, ramPeakMB: 120, mAP: 0.481, license: "Apache-2.0", notes: "Transformer; CPU parity with MobileNetV3.", available: false },
  { id: "ced_small", label: "CED-Small", diskMB: 85, ramPeakMB: 280, mAP: 0.496, license: "Apache-2.0", notes: "Best mid-range quality.", available: false },
  { id: "ced_base", label: "CED-Base (premium)", diskMB: 330, ramPeakMB: 600, mAP: 0.500, license: "Apache-2.0", notes: "SOTA-class quality.", available: false },
  { id: "pann_cnn14", label: "PANNs CNN14 (legacy)", diskMB: 313, ramPeakMB: 600, mAP: 0.431, license: "Apache-2.0", notes: "Original baseline. Kept as rollback option.", available: true },
];

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

// Drafts + apply handlers for the inference selectors. Same rollback-on-
// error pattern as updateRegistrationMode above.
const whisperModelDraft = ref<string | null>(null);
const whisperLanguageDraft = ref<string | null>(null);
const audioTaggerDraft = ref<string | null>(null);

watchEffect(() => {
  if (!settings.value) return;
  if (whisperModelDraft.value === null) {
    whisperModelDraft.value = settings.value.whisper_model ?? "large-v3";
  }
  if (whisperLanguageDraft.value === null) {
    whisperLanguageDraft.value = settings.value.whisper_language ?? "auto";
  }
  if (audioTaggerDraft.value === null) {
    audioTaggerDraft.value = settings.value.audio_detect_model ?? "efficientat_mn10";
  }
});

const selectedWhisper = computed<WhisperModelOption | null>(() => {
  const id = whisperModelDraft.value;
  return whisperModels.find((m) => m.id === id) ?? null;
});

const selectedAudioTagger = computed<AudioTaggerOption | null>(() => {
  const id = audioTaggerDraft.value;
  return audioTaggers.find((m) => m.id === id) ?? null;
});

const updatingWhisper = ref(false);
async function updateWhisperModel(next: string) {
  if (!settings.value || next === (settings.value.whisper_model ?? "large-v3")) return;
  updatingWhisper.value = true;
  const previous = settings.value.whisper_model ?? "large-v3";
  try {
    const updated = await api.admin.updateSettings({ whisper_model: next });
    settings.value = updated;
    whisperModelDraft.value = updated.whisper_model ?? "large-v3";
    toast.add({ title: `Transcription model: ${next}`, color: "success" });
  } catch (error: unknown) {
    whisperModelDraft.value = previous;
    const message = error instanceof Error ? error.message : "Failed to update model";
    toast.add({ title: message, color: "error" });
  } finally {
    updatingWhisper.value = false;
  }
}

async function updateWhisperLanguage(next: string) {
  if (!settings.value || next === (settings.value.whisper_language ?? "auto")) return;
  updatingWhisper.value = true;
  const previous = settings.value.whisper_language ?? "auto";
  try {
    const updated = await api.admin.updateSettings({ whisper_language: next });
    settings.value = updated;
    whisperLanguageDraft.value = updated.whisper_language ?? "auto";
    toast.add({ title: `Transcription language: ${next}`, color: "success" });
  } catch (error: unknown) {
    whisperLanguageDraft.value = previous;
    const message = error instanceof Error ? error.message : "Failed to update language";
    toast.add({ title: message, color: "error" });
  } finally {
    updatingWhisper.value = false;
  }
}

const updatingAudioTagger = ref(false);
async function updateAudioTagger(next: string) {
  if (!settings.value || next === (settings.value.audio_detect_model ?? "efficientat_mn10")) return;
  updatingAudioTagger.value = true;
  const previous = settings.value.audio_detect_model ?? "efficientat_mn10";
  try {
    const updated = await api.admin.updateSettings({ audio_detect_model: next });
    settings.value = updated;
    audioTaggerDraft.value = updated.audio_detect_model ?? "efficientat_mn10";
    toast.add({ title: `Audio tagger: ${next}`, color: "success" });
  } catch (error: unknown) {
    audioTaggerDraft.value = previous;
    const message = error instanceof Error ? error.message : "Failed to update audio tagger";
    toast.add({ title: message, color: "error" });
  } finally {
    updatingAudioTagger.value = false;
  }
}

const updatingRegistrationMode = ref(false);
async function updateRegistrationMode(next: RegistrationMode) {
  if (!settings.value || next === settings.value.registration_mode) return;
  updatingRegistrationMode.value = true;
  const previous = settings.value.registration_mode;
  try {
    const updated = await api.admin.updateSettings({ registration_mode: next });
    settings.value = updated;
    registrationModeDraft.value = updated.registration_mode;
    toast.add({ title: "Registration mode updated", color: "success" });
  } catch (error: unknown) {
    registrationModeDraft.value = previous;
    const message = error instanceof Error ? error.message : "Failed to update settings";
    toast.add({ title: message, color: "error" });
  } finally {
    updatingRegistrationMode.value = false;
  }
}

interface VersionInfo {
  commit: string;
  buildTime: string;
  dirty: boolean;
  mode: string;
}
const { data: versionInfo } = useApiFetch<VersionInfo>("/api/version");

const GITHUB_REPO = "https://github.com/rustyguts/alcoves";
const versionDisplay = computed(() => {
  const sha = versionInfo.value?.commit;
  if (!sha) return null;
  return {
    short: sha.slice(0, 7),
    href: `${GITHUB_REPO}/commit/${sha}`,
    dirty: versionInfo.value?.dirty ?? false,
    buildTime: versionInfo.value?.buildTime || null,
  };
});

const roleDrafts = reactive<Record<string, AdminUser["role"]>>({});
const updatingRoleUserId = ref<string | null>(null);

watchEffect(() => {
  if (!users.value) return;
  for (const user of users.value) {
    roleDrafts[user.id] = user.role;
  }
});

async function updateUserRole(user: AdminUser, nextRole: AdminUser["role"]) {
  if (!nextRole || nextRole === user.role) return;
  updatingRoleUserId.value = user.id;
  try {
    const updated = await api.admin.updateUserRole(user.id, { role: nextRole });
    user.role = updated.role;
    roleDrafts[user.id] = updated.role;
    toast.add({ title: "Role updated", color: "success" });
  } catch (error: unknown) {
    roleDrafts[user.id] = user.role;
    const message = error instanceof Error ? error.message : "Failed to update role";
    toast.add({ title: message, color: "error" });
  } finally {
    updatingRoleUserId.value = null;
  }
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface StatCard {
  key: string;
  title: string;
  value: string;
  caption: string;
  icon: string;
  color: string;
}

const statCards = computed<StatCard[]>(() => [
  {
    key: "files",
    title: "Files",
    value: stats.value?.files?.toLocaleString("en-US") ?? "—",
    caption: "Active across all libraries",
    icon: ICONS.files,
    color: "text-primary bg-primary-500/10",
  },
  {
    key: "storage",
    title: "Storage",
    value: stats.value ? formatFileSize(stats.value.totalSize) : "—",
    caption: "Total disk usage",
    icon: ICONS.storage,
    color: "text-secondary bg-secondary-500/10",
  },
  {
    key: "libraries",
    title: "Libraries",
    value: stats.value?.libraries?.toLocaleString("en-US") ?? "—",
    caption: "Including personal defaults",
    icon: ICONS.library,
    color: "text-info bg-info-500/10",
  },
  {
    key: "users",
    title: "Users",
    value: stats.value?.users?.toLocaleString("en-US") ?? "—",
    caption: "Registered accounts",
    icon: ICONS.members,
    color: "text-success bg-success-500/10",
  },
  {
    key: "folders",
    title: "Folders",
    value: stats.value?.folders?.toLocaleString("en-US") ?? "—",
    caption: "Active folder hierarchy",
    icon: ICONS.folder,
    color: "text-warning bg-warning-500/10",
  },
]);

const USelect = resolveComponent("USelect");

const roleOptions = [
  { label: "Owner", value: "owner" },
  { label: "Member", value: "member" },
];

const columns: TableColumn<AdminUser>[] = [
  {
    accessorKey: "displayName",
    header: "User",
    cell: ({ row }) =>
      h("div", { class: "flex items-center gap-3" }, [
        h(UserAvatar, {
          displayName: row.original.displayName,
          avatarUrl: row.original.avatarUrl,
          sizeClass: "w-8",
        }),
        h("div", { class: "min-w-0" }, [
          h("p", { class: "font-medium text-sm truncate" }, row.original.displayName),
          h("p", { class: "text-xs text-muted truncate" }, row.original.email),
        ]),
      ]),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) =>
      h(USelect, {
        modelValue: roleDrafts[row.original.id] ?? row.original.role,
        "onUpdate:modelValue": (v: AdminUser["role"]) => {
          roleDrafts[row.original.id] = v;
          updateUserRole(row.original, v);
        },
        items: roleOptions,
        size: "xs",
        disabled:
          updatingRoleUserId.value === row.original.id || currentUser.value?.id === row.original.id,
        class: "w-28",
      }),
  },
  {
    accessorKey: "createdAt",
    header: "Joined",
    cell: ({ row }) =>
      h("span", { class: "text-xs text-muted" }, formatDateTime(row.original.createdAt)),
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) =>
      h("span", { class: "text-xs text-muted" }, formatDateTime(row.original.updatedAt)),
  },
];
</script>

<template>
  <div class="space-y-6 overflow-y-auto flex-1 min-h-0 px-0.5">
    <div>
      <h1 class="text-2xl font-bold">Admin Dashboard</h1>
      <p class="text-sm text-muted mt-0.5">
        Instance overview, user management, and background jobs.
      </p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <UCard v-for="s in statCards" :key="s.key" :ui="{ body: 'p-4' }">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs text-muted">{{ s.title }}</p>
            <p class="text-3xl font-semibold mt-1">{{ s.value }}</p>
            <p class="text-xs text-muted mt-1">{{ s.caption }}</p>
          </div>
          <div class="flex size-10 items-center justify-center rounded-lg" :class="s.color">
            <UIcon :name="s.icon" class="size-5" />
          </div>
        </div>
      </UCard>
    </div>

    <AppPanel
      title="Registration"
      description="Control who can create accounts on this instance."
      :icon="ICONS.person"
    >
      <div class="flex flex-col gap-1">
        <label
          v-for="mode in registrationModes"
          :key="mode.value"
          class="flex items-start gap-3 cursor-pointer rounded-lg p-3 hover:bg-elevated/50"
        >
          <input
            type="radio"
            name="registration-mode"
            class="mt-1"
            :value="mode.value"
            :checked="registrationModeDraft === mode.value"
            :disabled="updatingRegistrationMode"
            @change="updateRegistrationMode(mode.value)"
          />
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ mode.label }}</p>
            <p class="text-xs text-muted">{{ mode.description }}</p>
          </div>
        </label>
      </div>
    </AppPanel>

    <AppPanel
      title="Inference models"
      description="Switch the transcription model and audio-tagger used by background workers. Changes take effect on the next job; long-running jobs already in flight finish on the previous model."
      :icon="ICONS.models"
    >
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="space-y-3">
          <div>
            <p class="text-sm font-medium">Transcription model (whisper.cpp)</p>
            <p class="text-xs text-muted">
              Lower WER = better accuracy. RAM peak is the inference high-water
              mark for whisper-cli; budget headroom for ffmpeg + the rest of
              the worker pod.
            </p>
          </div>
          <USelect
            :model-value="whisperModelDraft ?? 'large-v3'"
            :items="whisperModels.map((m) => ({ label: m.label, value: m.id }))"
            :disabled="updatingWhisper"
            size="sm"
            @update:model-value="(v: string) => { whisperModelDraft = v; updateWhisperModel(v); }"
          />
          <div v-if="selectedWhisper" class="rounded-md bg-elevated/50 p-3 text-xs space-y-1.5">
            <p class="text-default">{{ selectedWhisper.notes }}</p>
            <div class="grid grid-cols-2 gap-2 text-muted">
              <p>Disk: <span class="text-default">{{ formatMB(selectedWhisper.diskMB) }}</span></p>
              <p>RAM peak: <span class="text-default">{{ formatMB(selectedWhisper.ramPeakMB) }}</span></p>
              <p>CPU speed: <span class="text-default">~{{ selectedWhisper.realtime }}× realtime</span></p>
              <p>WER (clean/other): <span class="text-default">{{ selectedWhisper.werClean.toFixed(1) }}% / {{ selectedWhisper.werOther.toFixed(1) }}%</span></p>
              <p v-if="selectedWhisper.english" class="col-span-2 text-warning">English-only</p>
              <p v-if="selectedWhisper.ramPeakMB >= 3000" class="col-span-2 text-warning">
                ⚠️ Needs ≥4 GB RAM in the worker pod.
              </p>
            </div>
          </div>
          <div class="pt-1">
            <p class="text-xs text-muted mb-1">Language</p>
            <USelect
              :model-value="whisperLanguageDraft ?? 'auto'"
              :items="whisperLanguages.map((l) => ({ label: l.label, value: l.id }))"
              :disabled="updatingWhisper"
              size="sm"
              @update:model-value="(v: string) => { whisperLanguageDraft = v; updateWhisperLanguage(v); }"
            />
          </div>
        </div>

        <div class="space-y-3">
          <div>
            <p class="text-sm font-medium">Audio tagger (AudioSet 527 classes)</p>
            <p class="text-xs text-muted">
              Powers the per-clip event labels (music, speech, applause, …).
              Higher mAP = better tagging quality. Every model shares the same
              527-class label space, so existing HighlightFilter expressions
              keep working after a swap.
            </p>
          </div>
          <USelect
            :model-value="audioTaggerDraft ?? 'efficientat_mn10'"
            :items="audioTaggers.map((m) => ({ label: m.available ? m.label : `${m.label} — not yet available`, value: m.id, disabled: !m.available }))"
            :disabled="updatingAudioTagger"
            size="sm"
            @update:model-value="(v: string) => { audioTaggerDraft = v; updateAudioTagger(v); }"
          />
          <div v-if="selectedAudioTagger" class="rounded-md bg-elevated/50 p-3 text-xs space-y-1.5">
            <p class="text-default">{{ selectedAudioTagger.notes }}</p>
            <div class="grid grid-cols-2 gap-2 text-muted">
              <p>Disk: <span class="text-default">{{ formatMB(selectedAudioTagger.diskMB) }}</span></p>
              <p>RAM peak: <span class="text-default">{{ formatMB(selectedAudioTagger.ramPeakMB) }}</span></p>
              <p>mAP (AudioSet): <span class="text-default">{{ selectedAudioTagger.mAP.toFixed(3) }}</span></p>
              <p>License: <span class="text-default">{{ selectedAudioTagger.license }}</span></p>
            </div>
          </div>
          <p class="text-xs text-muted">
            New tagger applies to <em>future</em> detection jobs. Re-run via
            the bulk action on a library's settings page to backfill existing
            files with the new model.
          </p>
        </div>
      </div>
    </AppPanel>

    <AppPanel title="Users" description="Manage accounts and roles." :icon="ICONS.members" flush>
      <template #actions>
        <UBadge v-if="users" color="neutral" variant="subtle">{{ users.length }}</UBadge>
      </template>

      <div v-if="usersStatus === 'pending'" class="flex justify-center py-12">
        <UIcon :name="ICONS.loading" class="size-6 animate-spin text-muted" />
      </div>
      <div v-else-if="users?.length" class="overflow-x-auto">
        <UTable :data="users" :columns="columns" />
      </div>
      <p v-else class="px-6 pb-6 text-sm text-muted">No users found.</p>
    </AppPanel>

    <AdminJobsPanel embedded />

    <footer
      v-if="versionDisplay"
      class="flex items-center justify-end gap-2 pt-2 pb-4 text-xs text-muted"
    >
      <span>Version</span>
      <a
        :href="versionDisplay.href"
        target="_blank"
        rel="noopener noreferrer"
        class="font-mono underline hover:text-default"
      >
        {{ versionDisplay.short }}
      </a>
      <UBadge v-if="versionDisplay.dirty" color="warning" variant="subtle" size="xs">
        dirty
      </UBadge>
      <span v-if="versionDisplay.buildTime" class="text-muted/70">
        · built {{ formatDateTime(versionDisplay.buildTime) }}
      </span>
    </footer>
  </div>
</template>
