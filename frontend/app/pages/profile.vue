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

function discardAvatar() {
  selectedAvatar.value = null;
  if (avatarInput.value) avatarInput.value.value = "";
  if (avatarPreviewUrl.value) {
    URL.revokeObjectURL(avatarPreviewUrl.value);
    avatarPreviewUrl.value = null;
  }
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

    discardAvatar();
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

const themeOptions: { label: string; value: ColorPreference; icon: string; hint: string }[] = [
  { label: "System", value: "auto", icon: "i-lineicons-monitor", hint: "Match device" },
  { label: "Light", value: "light", icon: "i-lineicons-sun", hint: "Always light" },
  { label: "Dark", value: "dark", icon: "i-lineicons-night", hint: "Always dark" },
];
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto px-0.5 pb-8">
    <!-- Identity hero — flat, sits directly on the page, no card chrome -->
    <header class="flex flex-col items-center gap-5 pt-1 text-center sm:flex-row sm:text-left">
      <button
        type="button"
        class="group relative shrink-0 rounded-full transition focus:outline-none"
        @click="openAvatarPicker"
      >
        <UAvatar
          :src="currentAvatarSrc ?? undefined"
          :text="avatarInitial"
          :alt="user?.displayName ?? 'User'"
          size="3xl"
          class="ring-4 ring-default/60 transition group-hover:ring-primary-500/30"
        />
        <span
          class="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition group-hover:opacity-100"
        >
          <UIcon name="i-lineicons-camera" class="size-6 text-white" />
        </span>
      </button>

      <div class="min-w-0 flex-1">
        <h1 class="truncate text-2xl font-semibold text-highlighted">
          {{ user?.displayName || "Your profile" }}
        </h1>
        <div
          class="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 sm:justify-start"
        >
          <span class="inline-flex max-w-full items-center gap-1.5 text-sm text-muted">
            <UIcon name="i-lineicons-envelope" class="size-4 shrink-0" />
            <span class="break-all">{{ user?.email }}</span>
          </span>
          <UBadge
            v-if="user?.role"
            :color="user.role === 'owner' ? 'primary' : 'neutral'"
            variant="subtle"
            size="sm"
            class="capitalize"
          >
            {{ user.role }}
          </UBadge>
        </div>
        <button
          type="button"
          class="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition hover:text-primary-600"
          @click="openAvatarPicker"
        >
          <UIcon name="i-lineicons-camera" class="size-3.5" />
          Change photo
        </button>
      </div>

      <input
        ref="avatarInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onAvatarSelected"
      />
    </header>

    <!-- Account -->
    <AppPanel
      title="Account"
      description="Update how your name appears across Alcoves."
      icon="i-lineicons-user-4"
    >
      <template #actions>
        <UButton
          color="primary"
          :loading="saving"
          :disabled="!hasProfileChanges"
          icon="i-lineicons-save"
          @click="save"
        >
          Save changes
        </UButton>
      </template>

      <div class="space-y-4">
        <UFormField label="Display name">
          <UInput
            v-model="displayName"
            placeholder="Display name"
            size="lg"
            class="w-full"
            :ui="{ root: 'w-full' }"
          />
        </UFormField>

        <div
          v-if="selectedAvatar"
          class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary-500/10 px-3 py-2 text-sm text-primary"
        >
          <span class="inline-flex items-center gap-2">
            <UIcon name="i-lineicons-camera" class="size-4 shrink-0" />
            New photo selected — save changes to apply.
          </span>
          <UButton color="primary" variant="ghost" size="xs" @click="discardAvatar">
            Discard
          </UButton>
        </div>
      </div>
    </AppPanel>

    <!-- Appearance -->
    <AppPanel
      title="Appearance"
      description="Choose how Alcoves looks on this device."
      icon="i-lineicons-colour-palette-3"
    >
      <div class="grid grid-cols-3 gap-2 sm:gap-3">
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          type="button"
          class="relative flex flex-col items-center gap-1.5 rounded-md px-3 py-4 text-center transition"
          :class="
            themePreference === opt.value
              ? 'bg-primary-500/10 ring-1 ring-inset ring-primary-500'
              : 'bg-elevated/60 hover:bg-elevated'
          "
          @click="themePreference = opt.value"
        >
          <UIcon
            v-if="themePreference === opt.value"
            name="i-lineicons-check-circle-1"
            class="absolute right-2 top-2 size-4 text-primary"
          />
          <UIcon
            :name="opt.icon"
            class="size-6"
            :class="themePreference === opt.value ? 'text-primary' : 'text-muted'"
          />
          <span class="text-sm font-medium">{{ opt.label }}</span>
          <span class="text-xs text-muted">{{ opt.hint }}</span>
        </button>
      </div>
    </AppPanel>

    <!-- Active sessions -->
    <AppPanel
      title="Active sessions"
      description="Revoke any session you don't recognise."
      icon="i-lineicons-shield-2-check"
    >
      <template #actions>
        <UBadge color="neutral" variant="soft">{{ sessions?.length ?? 0 }}</UBadge>
      </template>

      <div
        v-if="sessions?.length"
        class="divide-y divide-default overflow-hidden rounded-md bg-elevated"
      >
        <div
          v-for="session in sessions"
          :key="session.id"
          class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div class="flex min-w-0 items-center gap-3">
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-default text-dimmed"
            >
              <UIcon name="i-lineicons-monitor" class="size-4" />
            </div>
            <div class="min-w-0 space-y-0.5">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium text-highlighted">
                  {{ parseBrowser(session.userAgent) }}
                </span>
                <UBadge v-if="session.isCurrent" color="primary" variant="subtle" size="sm">
                  Current
                </UBadge>
              </div>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                <span v-if="session.ipAddress">{{ session.ipAddress }}</span>
                <span v-if="session.ipAddress" aria-hidden="true">·</span>
                <span>Signed in {{ formatSessionDate(session.createdAt) }}</span>
              </div>
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
        icon="i-lineicons-shield-2-check"
        title="No other active sessions"
        description="Only this browser session is active right now."
      />
    </AppPanel>

    <ProfileAccessTokensSection />
  </div>
</template>
