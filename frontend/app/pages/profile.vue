<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import { useTheme, daisyThemes } from "~/composables/useTheme";
import type { DaisyTheme } from "~/composables/useTheme";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";

import type { SessionInfo } from "~~/shared/types/api";

const MAX_AVATAR_UPLOAD_BYTES = 25 * 1024 * 1024;

const { user, updateProfile, uploadAvatar } = useAuth();
const toast = useToast();
const { preference: themePreference } = useTheme();

const displayName = ref(user.value?.displayName ?? "");
const displayNameInput = ref<HTMLInputElement | null>(null);
const avatarInput = ref<HTMLInputElement | null>(null);
const selectedAvatar = ref<File | null>(null);
const avatarPreviewUrl = ref<string | null>(null);
const saving = ref(false);
const editingDisplayName = ref(false);
const highlightSave = ref(false);

watch(user, (u) => {
  if (u) {
    displayName.value = u.displayName;
  }
});

const currentAvatarSrc = computed(() => avatarPreviewUrl.value ?? user.value?.avatarUrl ?? null);
const hasProfileChanges = computed(() => {
  const nextDisplayName = displayName.value.trim();
  const hasDisplayNameUpdate = !!(nextDisplayName && nextDisplayName !== user.value?.displayName);
  return hasDisplayNameUpdate || !!selectedAvatar.value;
});

function startEditingDisplayName() {
  editingDisplayName.value = true;
  highlightSave.value = true;
  nextTick(() => {
    displayNameInput.value?.focus();
    displayNameInput.value?.select();
  });
}

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
    editingDisplayName.value = false;
    highlightSave.value = false;
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
</script>

<template>
  <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto pb-6">
    <section
      class="hero rounded-box bg-gradient-to-br from-primary/20 via-base-200 to-secondary/20"
    >
      <div
        class="hero-content w-full flex-col items-center gap-3 px-4 py-6 text-center sm:px-6 sm:py-8"
      >
        <button type="button" class="avatar cursor-pointer" @click="openAvatarPicker">
          <div
            v-if="currentAvatarSrc"
            class="size-20 rounded-full ring ring-primary/20 ring-offset-2 ring-offset-base-100"
          >
            <img :src="currentAvatarSrc" alt="" class="size-full object-cover" />
          </div>
          <div
            v-else
            class="size-20 rounded-full bg-primary text-primary-content flex items-center justify-center text-3xl font-bold ring ring-primary/20 ring-offset-2 ring-offset-base-100"
          >
            {{ user?.displayName?.charAt(0).toUpperCase() ?? "U" }}
          </div>
        </button>
        <div class="min-w-0 w-full space-y-1">
          <button
            v-if="!editingDisplayName"
            type="button"
            class="truncate text-3xl font-bold tracking-tight transition-colors hover:text-primary"
            @click="startEditingDisplayName"
          >
            {{ user?.displayName || "User" }}
          </button>
          <input
            v-else
            ref="displayNameInput"
            v-model="displayName"
            class="input input-md sm:input-lg mx-auto w-full max-w-xs sm:max-w-sm"
            placeholder="Your display name"
            @keydown.enter="save"
          />
          <p class="truncate text-sm text-base-content/70">{{ user?.email }}</p>
        </div>
        <div class="flex items-center">
          <button
            class="btn btn-soft btn-primary"
            :class="highlightSave || hasProfileChanges ? 'ring ring-primary/30' : ''"
            :disabled="saving || !hasProfileChanges"
            @click="save"
          >
            <span v-if="saving" class="loading loading-spinner loading-xs"></span>
            Save
          </button>
        </div>
      </div>
      <input
        ref="avatarInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onAvatarSelected"
      />
    </section>

    <section class="card bg-base-100">
      <div class="card-body gap-4">
        <h2 class="card-title text-base">Appearance</h2>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Theme</legend>
          <select
            :value="themePreference"
            class="select w-full capitalize"
            @change="
              themePreference = ($event.target as HTMLSelectElement).value as DaisyTheme | 'auto'
            "
          >
            <option value="auto">System</option>
            <option v-for="t in daisyThemes" :key="t" :value="t" class="capitalize">
              {{ t }}
            </option>
          </select>
        </fieldset>
      </div>
    </section>

    <section class="card bg-base-100">
      <div class="card-body gap-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-xl font-semibold">Active Sessions</h2>
            <p class="text-sm text-base-content/60">
              Manage your active sessions. Revoke any session you don't recognize.
            </p>
          </div>
          <span class="badge badge-outline">{{ sessions?.length ?? 0 }} total</span>
        </div>

        <div v-if="sessions?.length" class="grid gap-3">
          <div
            v-for="session in sessions"
            :key="session.id"
            class="flex items-center justify-between rounded-box border border-base-300/70 bg-base-200/40 p-4"
          >
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <AppIcon name="i-lucide-monitor" class="size-4 text-base-content/60" />
                <span class="font-medium">{{ parseBrowser(session.userAgent) }}</span>
                <span v-if="session.isCurrent" class="badge badge-primary badge-sm">Current</span>
              </div>
              <div class="flex flex-wrap items-center gap-3 text-xs text-base-content/60">
                <span v-if="session.ipAddress">{{ session.ipAddress }}</span>
                <span>Signed in {{ formatSessionDate(session.createdAt) }}</span>
              </div>
            </div>
            <button
              v-if="!session.isCurrent"
              class="btn btn-soft btn-error btn-outline btn-xs"
              :disabled="revokingId === session.id"
              @click="revokeSession(session.id)"
            >
              <span
                v-if="revokingId === session.id"
                class="loading loading-spinner loading-xs"
              ></span>
              Revoke
            </button>
          </div>
        </div>
        <div v-else class="alert alert-info/70">
          <AppIcon name="i-lucide-shield-check" class="size-4" />
          <span class="text-sm">No active sessions found.</span>
        </div>
      </div>
    </section>
  </div>
</template>
