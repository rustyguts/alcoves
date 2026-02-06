<script setup lang="ts">
definePageMeta({
  layout: "dashboard",
});

interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

const { user, updateProfile } = useAuth();
const toast = useToast();
const colorMode = useColorMode();

const displayName = ref(user.value?.displayName ?? "");
const avatarUrl = ref(user.value?.avatarUrl ?? "");
const saving = ref(false);

watch(user, (u) => {
  if (u) {
    displayName.value = u.displayName;
    avatarUrl.value = u.avatarUrl ?? "";
  }
});

async function save() {
  saving.value = true;
  try {
    await updateProfile({
      displayName: displayName.value,
      avatarUrl: avatarUrl.value || undefined,
    });
    toast.add({ title: "Profile updated", color: "success" });
  } catch {
    toast.add({ title: "Failed to update profile", color: "error" });
  } finally {
    saving.value = false;
  }
}

// Sessions
const { data: sessions, refresh: refreshSessions } =
  await useFetch<SessionInfo[]>("/api/auth/sessions");

const revokingId = ref<string | null>(null);

async function revokeSession(id: string) {
  revokingId.value = id;
  try {
    await $fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
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
</script>

<template>
  <div class="mx-auto max-w-lg flex flex-col gap-6">
    <div class="flex items-center gap-4">
      <div
        v-if="user?.avatarUrl"
        class="size-16 rounded-full overflow-hidden border-2 border-default"
      >
        <img :src="user.avatarUrl" alt="" class="size-full object-cover" />
      </div>
      <div
        v-else
        class="size-16 rounded-full bg-(--ui-primary) text-white flex items-center justify-center font-bold text-2xl border-2 border-default"
      >
        {{ user?.displayName?.charAt(0).toUpperCase() ?? "U" }}
      </div>
      <div>
        <h1 class="text-xl font-semibold">Hey Profile</h1>
        <p class="text-sm text-muted">{{ user?.email }}</p>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <UFormField label="Display Name">
        <UInput v-model="displayName" placeholder="Your display name" class="w-full" />
      </UFormField>

      <UFormField label="Avatar URL">
        <UInput v-model="avatarUrl" placeholder="https://example.com/avatar.jpg" class="w-full" />
      </UFormField>

      <div v-if="avatarUrl" class="flex items-center gap-3">
        <img
          :src="avatarUrl"
          alt="Avatar preview"
          class="size-12 rounded-full object-cover border border-default"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <span class="text-sm text-muted">Preview</span>
      </div>

      <UFormField label="Theme">
        <USelectMenu
          :model-value="colorMode.preference"
          :items="[
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]"
          value-key="value"
          class="w-full"
          @update:model-value="colorMode.preference = $event"
        />
      </UFormField>

      <div class="flex justify-end">
        <UButton label="Save" :loading="saving" @click="save" />
      </div>
    </div>

    <USeparator />

    <div class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold">Active Sessions</h2>
      <p class="text-sm text-muted">
        Manage your active sessions. Revoke any session you don't recognize.
      </p>

      <div v-if="sessions?.length" class="flex flex-col gap-3">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="flex items-center justify-between rounded-lg border border-default p-3"
        >
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-monitor" class="size-4 text-muted" />
              <span class="text-sm font-medium">{{ parseBrowser(session.userAgent) }}</span>
              <UBadge v-if="session.isCurrent" label="Current" color="primary" size="xs" />
            </div>
            <div class="flex items-center gap-3 text-xs text-muted">
              <span v-if="session.ipAddress">{{ session.ipAddress }}</span>
              <span>{{ new Date(session.createdAt).toLocaleDateString() }}</span>
            </div>
          </div>
          <UButton
            v-if="!session.isCurrent"
            label="Revoke"
            color="error"
            variant="ghost"
            size="xs"
            :loading="revokingId === session.id"
            @click="revokeSession(session.id)"
          />
        </div>
      </div>
      <p v-else class="text-sm text-muted">No active sessions found.</p>
    </div>
  </div>
</template>
