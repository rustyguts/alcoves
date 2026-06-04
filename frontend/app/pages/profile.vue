<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import { useTheme } from "~/composables/useTheme";
import type { ColorPreference } from "~/composables/useTheme";
import { useToast } from "~/composables/useToast";
import type { SessionInfo } from "~~/shared/types/api";

definePageMeta({ layout: "dashboard" });

const MAX_AVATAR_UPLOAD_BYTES = 25 * 1024 * 1024;

const { user, updateProfile, uploadAvatar } = useAuth();
const toast = useToast();
const { preference: themePreference } = useTheme();

const displayName = ref(user.value?.displayName ?? "");
const avatarInput = ref<HTMLInputElement | null>(null);
const selectedAvatar = ref<File | null>(null);
const avatarPreviewUrl = ref<string | null>(null);
const saving = ref(false);

watch(user, (u) => {
  if (u) displayName.value = u.displayName;
});

const currentAvatarSrc = computed(() => {
  if (avatarPreviewUrl.value) return avatarPreviewUrl.value;
  const remote = user.value?.avatarUrl;
  return remote ? apiUrl(remote) : null;
});
const avatarInitial = computed(() => (user.value?.displayName ?? "U").charAt(0).toUpperCase());
const hasProfileChanges = computed(() => {
  const nextDisplayName = displayName.value.trim();
  const hasDisplayNameUpdate = !!(nextDisplayName && nextDisplayName !== user.value?.displayName);
  return hasDisplayNameUpdate || !!selectedAvatar.value;
});

function openAvatarPicker() {
  avatarInput.value?.click();
}

function onAvatarSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast.add({ title: "Please select an image file", color: "error" });
    input.value = "";
    return;
  }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    toast.add({ title: "Avatar image is too large (max 25MB)", color: "error" });
    input.value = "";
    return;
  }
  selectedAvatar.value = file;
  if (avatarPreviewUrl.value) URL.revokeObjectURL(avatarPreviewUrl.value);
  avatarPreviewUrl.value = URL.createObjectURL(file);
}

onBeforeUnmount(() => {
  if (avatarPreviewUrl.value) URL.revokeObjectURL(avatarPreviewUrl.value);
});

async function save() {
  saving.value = true;
  try {
    const nextDisplayName = displayName.value.trim();
    const hasDisplayNameUpdate = !!(nextDisplayName && nextDisplayName !== user.value?.displayName);
    const hasAvatarUpdate = !!selectedAvatar.value;

    if (!hasDisplayNameUpdate && !hasAvatarUpdate) {
      toast.add({ title: "No changes to save", color: "neutral" });
      return;
    }

    if (hasDisplayNameUpdate) await updateProfile({ displayName: nextDisplayName });
    if (selectedAvatar.value) await uploadAvatar(selectedAvatar.value);

    selectedAvatar.value = null;
    if (avatarInput.value) avatarInput.value.value = "";
    if (avatarPreviewUrl.value) {
      URL.revokeObjectURL(avatarPreviewUrl.value);
      avatarPreviewUrl.value = null;
    }
    toast.add({ title: "Profile updated", color: "success" });
  } catch (error) {
    const message = getStatusMessage(error) ?? "Failed to update profile";
    toast.add({ title: message, color: "error" });
  } finally {
    saving.value = false;
  }
}

const { data: sessions, refresh: refreshSessions } =
  useApiFetch<SessionInfo[]>("/api/auth/sessions");

const revokingId = ref<string | null>(null);

async function revokeSession(id: string) {
  revokingId.value = id;
  try {
    await api.auth.revokeSession(id);
    toast.add({ title: "Session revoked", color: "success" });
    await refreshSessions();
  } catch {
    toast.add({ title: "Failed to revoke session", color: "error" });
  } finally {
    revokingId.value = null;
  }
}

function parseBrowser(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  return "Unknown browser";
}

function formatSessionDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function getStatusMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const maybeData = (error as { data?: unknown }).data;
  if (!maybeData || typeof maybeData !== "object") return null;
  const statusMessage = (maybeData as { statusMessage?: unknown }).statusMessage;
  return typeof statusMessage === "string" ? statusMessage : null;
}

const themeOptions: { label: string; value: ColorPreference; icon: string }[] = [
  { label: "System", value: "auto", icon: "i-lucide-monitor" },
  { label: "Light", value: "light", icon: "i-lucide-sun" },
  { label: "Dark", value: "dark", icon: "i-lucide-moon" },
];
</script>

<template>
  <div class="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 overflow-y-auto px-0.5 pb-6">
    <UCard
      :ui="{
        root: 'overflow-hidden',
        body: 'bg-gradient-to-br from-primary-500/10 via-default to-secondary-500/10 p-6 sm:p-10',
      }"
    >
      <div class="flex flex-col items-center gap-5 text-center">
        <button
          type="button"
          class="group relative rounded-full transition hover:ring-4 hover:ring-primary-500/20"
          @click="openAvatarPicker"
        >
          <UAvatar
            :src="currentAvatarSrc ?? undefined"
            :text="avatarInitial"
            :alt="user?.displayName ?? 'User'"
            size="3xl"
          />
          <span
            class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100"
          >
            <UIcon name="i-lucide-camera" class="size-6 text-white" />
          </span>
        </button>

        <div class="w-full max-w-sm space-y-2">
          <UInput
            v-model="displayName"
            placeholder="Display name"
            size="lg"
            class="w-full"
            :ui="{ root: 'w-full', base: 'text-center text-xl font-semibold' }"
          />
          <p class="text-sm text-muted">{{ user?.email }}</p>
          <div v-if="user?.role" class="flex justify-center">
            <UBadge
              :color="user.role === 'owner' ? 'primary' : 'neutral'"
              variant="subtle"
              size="sm"
              class="capitalize"
            >
              {{ user.role }}
            </UBadge>
          </div>
        </div>

        <UButton
          color="primary"
          size="lg"
          :loading="saving"
          :disabled="!hasProfileChanges"
          icon="i-lucide-save"
          @click="save"
        >
          Save changes
        </UButton>
      </div>

      <input
        ref="avatarInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onAvatarSelected"
      />
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-palette" class="size-5 text-primary" />
          <h2 class="text-base font-semibold">Appearance</h2>
        </div>
      </template>

      <div class="grid grid-cols-3 gap-3">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          type="button"
          class="flex flex-col items-center gap-2 rounded-lg border p-4 transition hover:border-primary-500 hover:bg-primary-500/5"
          :class="
            themePreference === opt.value
              ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500'
              : 'border-default'
          "
          @click="themePreference = opt.value"
        >
          <UIcon :name="opt.icon" class="size-6" />
          <span class="text-sm font-medium">{{ opt.label }}</span>
        </button>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">Active sessions</h2>
            <p class="text-sm text-muted">Revoke any session you don't recognise.</p>
          </div>
          <UBadge color="neutral" variant="outline">{{ sessions?.length ?? 0 }} total</UBadge>
        </div>
      </template>

      <div v-if="sessions?.length" class="grid gap-3">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="flex items-center justify-between rounded-lg border border-default bg-elevated/40 p-4"
        >
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-monitor" class="size-4 text-muted" />
              <span class="font-medium">{{ parseBrowser(session.userAgent) }}</span>
              <UBadge v-if="session.isCurrent" color="primary" size="sm">Current</UBadge>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span v-if="session.ipAddress">{{ session.ipAddress }}</span>
              <span>Signed in {{ formatSessionDate(session.createdAt) }}</span>
            </div>
          </div>
          <UButton
            v-if="!session.isCurrent"
            color="error"
            variant="soft"
            size="xs"
            :loading="revokingId === session.id"
            @click="revokeSession(session.id)"
          >
            Revoke
          </UButton>
        </div>
      </div>
      <UAlert
        v-else
        color="info"
        variant="soft"
        icon="i-lucide-shield-check"
        title="No other active sessions"
        description="Only this browser session is active right now."
      />
    </UCard>

    <ProfileAccessTokensSection />
  </div>
</template>
