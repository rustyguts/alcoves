<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";
import { useTheme, daisyThemes } from "~/composables/useTheme";
import type { DaisyTheme } from "~/composables/useTheme";
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
const { preference: themePreference } = useTheme();

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
  <div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto pb-6">
    <section class="hero rounded-box bg-gradient-to-br from-primary/20 via-base-200 to-secondary/20">
      <div class="hero-content w-full justify-between gap-6 px-6 py-8">
        <div class="space-y-2">
          <h1 class="text-3xl font-bold tracking-tight">Profile</h1>
          <p class="text-base-content/70">My Profile</p>
          <p class="text-sm text-base-content/60">
            Keep your account details current and secure.
          </p>
        </div>
        <div class="hidden items-center gap-3 md:flex">
          <span class="badge badge-outline">{{ user?.email }}</span>
          <span class="badge badge-primary badge-outline">Account</span>
        </div>
      </div>
    </section>

    <section class="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <article class="card bg-base-100">
        <div class="card-body gap-5">
          <div class="flex items-center gap-4">
            <div class="avatar">
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
            </div>
            <div class="space-y-1">
              <p class="text-lg font-semibold">{{ user?.displayName || "User" }}</p>
              <p class="text-sm text-base-content/60">{{ user?.email }}</p>
            </div>
          </div>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Display Name</legend>
            <input v-model="displayName" placeholder="Your display name" class="input w-full" />
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset-legend">Avatar Photo</legend>
            <p class="text-xs text-base-content/60">
              Upload an image. It will be center-cropped to 128x128.
            </p>
            <div class="mt-2 flex items-center gap-3">
              <button class="btn btn-outline btn-sm" @click="openAvatarPicker">
                <AppIcon name="i-lucide-image-plus" class="size-4" />
                Choose photo
              </button>
              <span v-if="selectedAvatar" class="max-w-xs truncate text-sm text-base-content/60">
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

          <div class="card-actions justify-end border-t border-base-300/60 pt-4">
            <button class="btn btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="loading loading-spinner loading-xs"></span>
              Save
            </button>
          </div>
        </div>
      </article>

      <aside class="space-y-6">
        <article class="card bg-base-100">
          <div class="card-body gap-4">
            <h2 class="card-title text-base">Appearance</h2>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">Theme</legend>
              <select
                :value="themePreference"
                class="select w-full capitalize"
                @change="themePreference = ($event.target as HTMLSelectElement).value as DaisyTheme | 'auto'"
              >
                <option value="auto">System</option>
                <option v-for="t in daisyThemes" :key="t" :value="t" class="capitalize">
                  {{ t }}
                </option>
              </select>
            </fieldset>
          </div>
        </article>

        <article class="stats stats-vertical bg-base-100">
          <div class="stat py-4">
            <div class="stat-title">Active Sessions</div>
            <div class="stat-value text-3xl">{{ sessions?.length ?? 0 }}</div>
            <div class="stat-desc">Devices signed into this account</div>
          </div>
        </article>
      </aside>
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
              class="btn btn-error btn-outline btn-xs"
              :disabled="revokingId === session.id"
              @click="revokeSession(session.id)"
            >
              <span v-if="revokingId === session.id" class="loading loading-spinner loading-xs"></span>
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
