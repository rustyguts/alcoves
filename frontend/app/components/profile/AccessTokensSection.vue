<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import { useToast } from "~/composables/useToast";
import type { AccessToken, CreatedAccessToken } from "~~/shared/types/api";

const toast = useToast();

const { data: tokens, refresh } = useApiFetch<AccessToken[]>("/api/auth/tokens");

const newName = ref("");
const newExpiry = ref<string>("never");
const creating = ref(false);
const revokingId = ref<string | null>(null);

// The plaintext token is shown exactly once, in a modal, right after creation.
const createdToken = ref<CreatedAccessToken | null>(null);
const showCreated = computed({
  get: () => createdToken.value !== null,
  set: (v: boolean) => {
    if (!v) createdToken.value = null;
  },
});

const expiryOptions = [
  { label: "Never expires", value: "never" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
  { label: "1 year", value: "365" },
];

async function createToken() {
  const name = newName.value.trim();
  if (!name) {
    toast.add({ title: "Give the token a name", color: "error" });
    return;
  }
  creating.value = true;
  try {
    const expiresInDays = newExpiry.value === "never" ? null : Number(newExpiry.value);
    const created = await api.auth.createToken({ name, expiresInDays });
    createdToken.value = created;
    newName.value = "";
    newExpiry.value = "never";
    await refresh();
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message ?? "Failed to create token";
    toast.add({ title: msg, color: "error" });
  } finally {
    creating.value = false;
  }
}

async function revokeToken(id: string) {
  revokingId.value = id;
  try {
    await api.auth.revokeToken(id);
    toast.add({ title: "Token revoked", color: "success" });
    await refresh();
  } catch {
    toast.add({ title: "Failed to revoke token", color: "error" });
  } finally {
    revokingId.value = null;
  }
}

async function copyToken() {
  if (!createdToken.value) return;
  try {
    await navigator.clipboard.writeText(createdToken.value.token);
    toast.add({ title: "Token copied to clipboard", color: "success" });
  } catch {
    toast.add({ title: "Could not copy — select and copy manually", color: "error" });
  }
}

function formatDate(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
</script>

<template>
  <AppPanel
    title="MCP access tokens"
    description="Connect the Alcoves MCP server. A token acts as you — it can only read and change what you can."
    :icon="ICONS.key"
  >
    <template #actions>
      <UBadge color="neutral" variant="soft">{{ tokens?.length ?? 0 }} active</UBadge>
    </template>

    <div class="space-y-5">
      <!-- Create -->
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
        <UFormField label="Name" hint="What is this token for?" class="flex-1">
          <UInput
            v-model="newName"
            placeholder="e.g. Claude Desktop on laptop"
            class="w-full"
            :ui="{ root: 'w-full' }"
            :disabled="creating"
            @keyup.enter="createToken"
          />
        </UFormField>
        <UFormField label="Expires">
          <USelect v-model="newExpiry" :items="expiryOptions" :disabled="creating" />
        </UFormField>
        <UButton
          color="primary"
          :icon="ICONS.plus"
          :loading="creating"
          :disabled="creating"
          @click="createToken"
        >
          Create token
        </UButton>
      </div>

      <USeparator />

      <!-- List -->
      <div
        v-if="tokens?.length"
        class="divide-y divide-default overflow-hidden rounded-md bg-elevated"
      >
        <div
          v-for="token in tokens"
          :key="token.id"
          class="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center"
        >
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-default text-dimmed"
            >
              <UIcon :name="ICONS.key" class="size-4" />
            </div>
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-highlighted">{{ token.name }}</p>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                <span>Created {{ formatDate(token.createdAt) }}</span>
                <span aria-hidden="true">·</span>
                <span>Expires {{ formatDate(token.expiresAt) }}</span>
                <span aria-hidden="true">·</span>
                <span>{{
                  token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : "Never used"
                }}</span>
              </div>
            </div>
          </div>
          <UButton
            color="error"
            variant="soft"
            size="sm"
            :icon="ICONS.trash"
            :loading="revokingId === token.id"
            :disabled="revokingId === token.id"
            @click="revokeToken(token.id)"
          >
            Revoke
          </UButton>
        </div>
      </div>
      <UAlert
        v-else
        color="neutral"
        variant="soft"
        :icon="ICONS.key"
        title="No access tokens yet"
        description="Create one to connect an MCP client to your Alcoves libraries."
      />
    </div>

    <!-- Show-once token modal -->
    <UModal
      v-model:open="showCreated"
      title="Copy your new token"
      description="This is the only time the token is shown. Store it somewhere safe."
    >
      <template #body>
        <div class="space-y-3">
          <div class="flex items-center gap-2">
            <UInput
              :model-value="createdToken?.token ?? ''"
              readonly
              class="w-full font-mono text-xs"
              :ui="{ root: 'w-full' }"
            />
            <UButton color="neutral" :icon="ICONS.copy" square @click="copyToken" />
          </div>
          <UAlert
            color="warning"
            variant="soft"
            :icon="ICONS.shield"
            title="Treat it like a password"
            description="Anyone with this token can access your libraries as you. Revoke it if it leaks."
          />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton color="primary" @click="showCreated = false">Done</UButton>
        </div>
      </template>
    </UModal>
  </AppPanel>
</template>
