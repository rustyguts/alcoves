<script setup lang="ts">
import { formatFileSize } from "~/utils/mime-icons";

definePageMeta({
  layout: "dashboard",
});

interface AdminStats {
  totalFiles: number;
  totalSizeBytes: number;
  averageFileSizeBytes: number;
  totalLibraries: number;
  totalUsers: number;
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
  lastLoggedInAt: string | null;
  uploadedFileCount: number;
  uploadedSizeBytes: number;
}

const toast = useToast();
const { user: currentUser } = useAuth();

const { data: stats, status: statsStatus, refresh: refreshStats } = await useFetch<AdminStats>(
  "/api/admin/stats",
);
const { data: users, status: usersStatus, refresh: refreshUsers } = await useFetch<AdminUser[]>(
  "/api/admin/users",
);

const roleDrafts = reactive<Record<string, AdminUser["role"]>>({});
const updatingRoleUserId = ref<string | null>(null);
const roleOptions = [
  { label: "Owner", value: "owner" as const },
  { label: "Member", value: "member" as const },
];

watchEffect(() => {
  if (!users.value) return;
  for (const user of users.value) {
    roleDrafts[user.id] = user.role;
  }
});

const statCards = computed(() => {
  const value = stats.value;
  if (!value) return [];
  return [
    {
      title: "Total Files",
      icon: "i-lucide-files",
      value: value.totalFiles.toLocaleString("en-US"),
      description: "Files uploaded on this server",
    },
    {
      title: "Total Storage",
      icon: "i-lucide-hard-drive",
      value: formatFileSize(value.totalSizeBytes),
      description: "Combined file storage usage",
    },
    {
      title: "Average File Size",
      icon: "i-lucide-scale",
      value: formatFileSize(value.averageFileSizeBytes),
      description: "Across all uploaded files",
    },
    {
      title: "Libraries",
      icon: "i-lucide-library",
      value: value.totalLibraries.toLocaleString("en-US"),
      description: "Total libraries in this instance",
    },
    {
      title: "Users",
      icon: "i-lucide-users",
      value: value.totalUsers.toLocaleString("en-US"),
      description: "Registered user accounts",
    },
  ];
});

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "Never";
  return new Date(dateString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function roleBadgeColor(role: AdminUser["role"]) {
  return role === "owner" ? "primary" : "neutral";
}

async function updateUserRole(user: AdminUser) {
  const nextRole = roleDrafts[user.id];
  if (!nextRole || nextRole === user.role) return;

  updatingRoleUserId.value = user.id;
  try {
    const updated = await $fetch<{ id: string; role: AdminUser["role"] }>(
      `/api/admin/users/${user.id}`,
      {
        method: "PATCH",
        body: { role: nextRole },
      },
    );

    user.role = updated.role;
    roleDrafts[user.id] = updated.role;
    toast.add({ title: "Role updated" });
  } catch (error: unknown) {
    roleDrafts[user.id] = user.role;
    const message =
      error && typeof error === "object"
        ? ((error as { data?: { statusMessage?: string } }).data?.statusMessage ?? null)
        : null;
    toast.add({ title: message ?? "Failed to update role", color: "error" });
  } finally {
    updatingRoleUserId.value = null;
  }
}

async function refreshAdminData() {
  await Promise.all([refreshStats(), refreshUsers()]);
}
</script>

<template>
  <div class="mx-auto max-w-7xl flex flex-col gap-6">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Admin</h1>
        <p class="text-sm text-muted mt-1">
          Instance-wide metrics and user administration for server owners.
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        label="Refresh"
        color="neutral"
        variant="outline"
        :loading="statsStatus === 'pending' || usersStatus === 'pending'"
        @click="refreshAdminData"
      />
    </div>

    <section class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
      <UCard
        v-for="card in statCards"
        :key="card.title"
        :ui="{ body: 'p-4' }"
        class="border border-default bg-elevated/40"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-xs font-medium text-muted uppercase tracking-wide">{{ card.title }}</p>
            <p class="text-2xl font-semibold mt-1">{{ card.value }}</p>
          </div>
          <div class="size-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <UIcon :name="card.icon" class="size-5" />
          </div>
        </div>
        <p class="text-xs text-muted mt-2">{{ card.description }}</p>
      </UCard>
    </section>

    <UCard :ui="{ body: 'p-0' }">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">User Management</h2>
            <p class="text-xs text-muted mt-1">
              Manage roles and review storage usage/activity for each account.
            </p>
          </div>
          <UBadge v-if="users" color="neutral" variant="soft">
            {{ users.length }} {{ users.length === 1 ? "user" : "users" }}
          </UBadge>
        </div>
      </template>

      <div v-if="usersStatus === 'pending'" class="flex items-center justify-center py-10">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div v-else-if="users?.length" class="overflow-x-auto">
        <table class="min-w-full">
          <thead>
            <tr class="border-b border-default bg-elevated/40">
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">User</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Role</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Storage Used</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Files Uploaded</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Last Logged In</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Joined</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in users"
              :key="user.id"
              class="border-b border-default/70 last:border-b-0 hover:bg-elevated/30 transition-colors"
            >
              <td class="px-4 py-3">
                <div class="flex items-center gap-3 min-w-[220px]">
                  <UAvatar :src="user.avatarUrl ?? undefined" :alt="user.displayName" size="sm" />
                  <div class="min-w-0">
                    <p class="text-sm font-medium truncate">{{ user.displayName }}</p>
                    <p class="text-xs text-muted truncate">{{ user.email }}</p>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="min-w-[170px] flex items-center gap-2">
                  <USelectMenu
                    v-model="roleDrafts[user.id]"
                    :items="roleOptions"
                    value-key="value"
                    class="w-28"
                    :loading="updatingRoleUserId === user.id"
                    :disabled="currentUser?.id === user.id"
                    @update:model-value="updateUserRole(user)"
                  />
                  <UBadge :color="roleBadgeColor(user.role)" variant="soft" size="xs">
                    {{ user.role }}
                  </UBadge>
                </div>
              </td>
              <td class="px-4 py-3 text-sm">{{ formatFileSize(user.uploadedSizeBytes) }}</td>
              <td class="px-4 py-3 text-sm">{{ user.uploadedFileCount.toLocaleString("en-US") }}</td>
              <td class="px-4 py-3 text-sm">{{ formatDateTime(user.lastLoggedInAt) }}</td>
              <td class="px-4 py-3 text-sm text-muted">{{ formatDateTime(user.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="p-6 text-sm text-muted">No users found.</div>
    </UCard>
  </div>
</template>
