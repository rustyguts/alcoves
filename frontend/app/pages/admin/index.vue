<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";
import { formatFileSize } from "~/utils/mime-icons";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";
import AdminJobsPanel from "~/components/admin/AdminJobsPanel.vue";
import UserAvatar from "~/components/UserAvatar.vue";

interface AdminStats {
  users: number;
  libraries: number;
  files: number;
  folders: number;
  totalSize: number;
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
}

const toast = useToast();
const { user: currentUser } = useAuth();

const { data: stats } = useApiFetch<AdminStats>("/api/admin/stats");
const { data: users, status: usersStatus } = useApiFetch<AdminUser[]>("/api/admin/users");

const roleDrafts = reactive<Record<string, AdminUser["role"]>>({});
const updatingRoleUserId = ref<string | null>(null);

watchEffect(() => {
  if (!users.value) return;
  for (const user of users.value) {
    roleDrafts[user.id] = user.role;
  }
});

async function updateUserRole(user: AdminUser) {
  const nextRole = roleDrafts[user.id];
  if (!nextRole || nextRole === user.role) return;

  updatingRoleUserId.value = user.id;
  try {
    const updated = await apiFetch<{ id: string; role: AdminUser["role"] }>(
      `/api/admin/users/${user.id}`,
      { method: "PATCH", body: { role: nextRole } },
    );
    user.role = updated.role;
    roleDrafts[user.id] = updated.role;
    toast.add({ title: "Role updated" });
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
</script>

<template>
  <div class="flex flex-col gap-6 overflow-y-auto flex-1 min-h-0">
    <!-- Header -->
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold">Admin Dashboard</h1>
        <p class="text-sm text-base-content/60 mt-0.5">
          Instance overview, user management, and background jobs.
        </p>
      </div>
    </div>

    <!-- Stat cards -->
    <div class="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-100">
      <div class="stat">
        <div class="stat-figure text-primary"><AppIcon name="i-lucide-files" class="size-6" /></div>
        <div class="stat-title">Files</div>
        <div class="stat-value text-primary">
          {{ stats?.files?.toLocaleString("en-US") ?? "—" }}
        </div>
        <div class="stat-desc">Active across all libraries</div>
      </div>
      <div class="stat">
        <div class="stat-figure text-secondary">
          <AppIcon name="i-lucide-hard-drive" class="size-6" />
        </div>
        <div class="stat-title">Storage</div>
        <div class="stat-value text-secondary">
          {{ stats ? formatFileSize(stats.totalSize) : "—" }}
        </div>
        <div class="stat-desc">Total disk usage</div>
      </div>
      <div class="stat">
        <div class="stat-figure text-accent">
          <AppIcon name="i-lucide-library" class="size-6" />
        </div>
        <div class="stat-title">Libraries</div>
        <div class="stat-value">{{ stats?.libraries?.toLocaleString("en-US") ?? "—" }}</div>
        <div class="stat-desc">Including personal defaults</div>
      </div>
      <div class="stat">
        <div class="stat-figure text-info"><AppIcon name="i-lucide-users" class="size-6" /></div>
        <div class="stat-title">Users</div>
        <div class="stat-value">{{ stats?.users?.toLocaleString("en-US") ?? "—" }}</div>
        <div class="stat-desc">Registered accounts</div>
      </div>
      <div class="stat">
        <div class="stat-figure text-warning">
          <AppIcon name="i-lucide-folder-tree" class="size-6" />
        </div>
        <div class="stat-title">Folders</div>
        <div class="stat-value">{{ stats?.folders?.toLocaleString("en-US") ?? "—" }}</div>
        <div class="stat-desc">Active folder hierarchy</div>
      </div>
    </div>

    <div class="card bg-base-100 shadow">
      <div class="card-body p-0">
        <div class="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 class="card-title text-lg">Users</h2>
            <p class="text-sm text-base-content/60">Manage accounts and roles.</p>
          </div>
          <div v-if="users" class="badge badge-ghost badge-sm">{{ users.length }}</div>
        </div>

        <div v-if="usersStatus === 'pending'" class="flex justify-center py-12">
          <span class="loading loading-spinner loading-md" />
        </div>

        <div v-else-if="users?.length" class="max-h-[30rem] overflow-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id" class="hover">
                <td>
                  <div class="flex items-center gap-3">
                    <UserAvatar
                      :display-name="u.displayName"
                      :avatar-url="u.avatarUrl"
                      size-class="w-8"
                    />
                    <div class="min-w-0">
                      <p class="font-medium text-sm truncate">{{ u.displayName }}</p>
                      <p class="text-xs text-base-content/50 truncate">{{ u.email }}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <select
                    v-model="roleDrafts[u.id]"
                    class="select select-xs select-bordered w-24"
                    :disabled="updatingRoleUserId === u.id || currentUser?.id === u.id"
                    @change="updateUserRole(u)"
                  >
                    <option value="owner">Owner</option>
                    <option value="member">Member</option>
                  </select>
                </td>
                <td class="text-xs text-base-content/60 whitespace-nowrap">
                  {{ formatDateTime(u.createdAt) }}
                </td>
                <td class="text-xs text-base-content/60 whitespace-nowrap">
                  {{ formatDateTime(u.updatedAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="px-6 pb-6 text-sm text-base-content/50">No users found.</div>
      </div>
    </div>

    <AdminJobsPanel embedded />
  </div>
</template>
