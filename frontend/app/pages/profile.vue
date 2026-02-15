<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";
import { useColorMode } from "@vueuse/core";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";

interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

const MAX_AVATAR_UPLOAD_BYTES = 25 * 1024 * 1024;

const { user, updateProfile, uploadAvatar } = useAuth();
const toast = useToast();
const colorMode = useColorMode();
const colorPreference = colorMode.store;

const displayName = ref(user.value?.displayName ?? "");
const avatarInput = ref<HTMLInputElement | null>(null);
const selectedAvatar = ref<File | null>(null);
const avatarPreviewUrl = ref<string | null>(null);
const saving = ref(false);

watch(user, (u) => {
  if (u) {
    displayName.value = u.displayName;
  }
});

const currentAvatarSrc = computed(() => avatarPreviewUrl.value ?? user.value?.avatarUrl ?? null);

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
  if (avatarPreviewUrl.value) {
    URL.revokeObjectURL(avatarPreviewUrl.value);
  }
  avatarPreviewUrl.value = URL.createObjectURL(file);
}

onBeforeUnmount(() => {
  if (avatarPreviewUrl.value) {
    URL.revokeObjectURL(avatarPreviewUrl.value);
  }
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

    if (hasDisplayNameUpdate) {
      await updateProfile({ displayName: nextDisplayName });
    }

    if (selectedAvatar.value) {
      await uploadAvatar(selectedAvatar.value);
    }

    selectedAvatar.value = null;
    if (avatarInput.value) {
      avatarInput.value.value = "";
    }
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

// Sessions
const { data: sessions, refresh: refreshSessions } =
  useApiFetch<SessionInfo[]>("/api/auth/sessions");

const revokingId = ref<string | null>(null);

async function revokeSession(id: string) {
  revokingId.value = id;
  try {
    await apiFetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
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
</script>

<template>
  <div class="mx-auto max-w-lg flex flex-col gap-6">
    <div class="flex items-center gap-4">
      <div v-if="currentAvatarSrc" class="size-16 rounded-full overflow-hidden">
        <img :src="currentAvatarSrc" alt="" class="size-full object-cover" />
      </div>
      <div
        v-else
        class="size-16 rounded-full bg-primary text-white flex items-center justify-center font-bold text-2xl"
      >
        {{ user?.displayName?.charAt(0).toUpperCase() ?? "U" }}
      </div>
      <div>
        <h1 class="text-xl font-semibold">My Profile</h1>
        <p class="text-sm text-muted">{{ user?.email }}</p>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Display Name</legend>
        <input v-model="displayName" placeholder="Your display name" class="input w-full" />
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Avatar Photo</legend>
        <p class="text-xs text-muted mb-1">Upload an image. It will be center-cropped to 128x128.</p>
        <div class="flex items-center gap-3">
          <button class="btn btn-ghost btn-sm" @click="openAvatarPicker">
            <AppIcon name="i-lucide-image-plus" class="size-4" />
            Choose photo
          </button>
          <span v-if="selectedAvatar" class="text-sm text-muted truncate">
            {{ selectedAvatar.name }}
          </span>
        </div>
        <input
          ref="avatarInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onAvatarSelected"
        />
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Theme</legend>
        <select
          :value="colorPreference"
          class="select w-full"
          @change="colorPreference = ($event.target as HTMLSelectElement).value as 'light' | 'dark' | 'auto'"
        >
          <option value="auto">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </fieldset>

      <div class="flex justify-end">
        <button class="btn btn-primary" :disabled="saving" @click="save">
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          Save
        </button>
      </div>
    </div>

    <div class="divider"></div>

    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold">Active Sessions</h2>
      <p class="text-sm text-muted">
        Manage your active sessions. Revoke any session you don't recognize.
      </p>

      <div v-if="sessions?.length" class="flex flex-col gap-3">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="flex items-center justify-between rounded-lg bg-elevated/50 p-3"
        >
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <AppIcon name="i-lucide-monitor" class="size-4 text-muted" />
              <span class="text-sm font-medium">{{ parseBrowser(session.userAgent) }}</span>
              <span v-if="session.isCurrent" class="badge badge-primary badge-sm">Current</span>
            </div>
            <div class="flex items-center gap-3 text-xs text-muted">
              <span v-if="session.ipAddress">{{ session.ipAddress }}</span>
              <span>{{ formatSessionDate(session.createdAt) }}</span>
            </div>
          </div>
          <button
            v-if="!session.isCurrent"
            class="btn btn-ghost btn-error btn-xs"
            :disabled="revokingId === session.id"
            @click="revokeSession(session.id)"
          >
            <span v-if="revokingId === session.id" class="loading loading-spinner loading-xs"></span>
            Revoke
          </button>
        </div>
      </div>
      <p v-else class="text-sm text-muted">No active sessions found.</p>
    </div>
  </div>
</template>
