<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";
import { formatFileSize } from "~/utils/mime-icons";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";

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

interface QueueStats {
  queues: Record<
    string,
    { active: number; completed: number; failed: number; waiting: number; delayed: number }
  >;
}

const toast = useToast();
const { user: currentUser } = useAuth();

const { data: stats, status: statsStatus, refresh: refreshStats } = useApiFetch<AdminStats>("/api/admin/stats");
const { data: users, status: usersStatus, refresh: refreshUsers } = useApiFetch<AdminUser[]>("/api/admin/users");

const queueStats = ref<QueueStats | null>(null);

async function fetchQueueStats() {
  try {
    queueStats.value = await apiFetch<QueueStats>("/api/admin/jobs/stats");
  } catch {
    // Queue not configured
  }
}

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

function formatQueueName(name: string): string {
  return name.replace(/^\{|\}$/g, "").replace(/-/g, " ");
}

function queueIcon(name: string): string {
  if (name.includes("face")) return "i-lucide-scan-face";
  if (name.includes("video")) return "i-lucide-video";
  if (name.includes("thumbnail")) return "i-lucide-image";
  return "i-lucide-layers";
}

const queueEntries = computed(() => {
  if (!queueStats.value?.queues) return [];
  return Object.entries(queueStats.value.queues).map(([name, counts]) => ({ name, ...counts }));
});

const totalQueueFailed = computed(() => queueEntries.value.reduce((s, q) => s + q.failed, 0));
const totalQueueActive = computed(() => queueEntries.value.reduce((s, q) => s + q.active, 0));
const totalQueueWaiting = computed(() => queueEntries.value.reduce((s, q) => s + q.waiting, 0));

async function refreshAll() {
  await Promise.all([refreshStats(), refreshUsers(), fetchQueueStats()]);
}

let refreshInterval: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  fetchQueueStats();
  refreshInterval = setInterval(fetchQueueStats, 10_000);
});
onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
});
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
      <button
        class="btn btn-sm btn-ghost gap-2"
        :disabled="statsStatus === 'pending' || usersStatus === 'pending'"
        @click="refreshAll"
      >
        <span v-if="statsStatus === 'pending'" class="loading loading-spinner loading-xs" />
        <AppIcon v-else name="i-lucide-refresh-cw" class="size-4" />
        Refresh
      </button>
    </div>

    <!-- Stat cards -->
    <div class="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-200">
      <div class="stat">
        <div class="stat-figure text-primary"><AppIcon name="i-lucide-files" class="size-6" /></div>
        <div class="stat-title">Files</div>
        <div class="stat-value text-primary">{{ stats?.files?.toLocaleString("en-US") ?? "—" }}</div>
        <div class="stat-desc">Active across all libraries</div>
      </div>
      <div class="stat">
        <div class="stat-figure text-secondary"><AppIcon name="i-lucide-hard-drive" class="size-6" /></div>
        <div class="stat-title">Storage</div>
        <div class="stat-value text-secondary">{{ stats ? formatFileSize(stats.totalSize) : "—" }}</div>
        <div class="stat-desc">Total disk usage</div>
      </div>
      <div class="stat">
        <div class="stat-figure text-accent"><AppIcon name="i-lucide-library" class="size-6" /></div>
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
        <div class="stat-figure text-warning"><AppIcon name="i-lucide-folder-tree" class="size-6" /></div>
        <div class="stat-title">Folders</div>
        <div class="stat-value">{{ stats?.folders?.toLocaleString("en-US") ?? "—" }}</div>
        <div class="stat-desc">Active folder hierarchy</div>
      </div>
    </div>

    <!-- Main grid: Users + Queues sidebar -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6 min-h-0">
      <!-- Users table -->
      <div class="xl:col-span-2">
        <div class="card bg-base-200 shadow">
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

            <div v-else-if="users?.length" class="overflow-x-auto">
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
                        <div class="avatar placeholder">
                          <div v-if="u.avatarUrl" class="w-8 rounded-full">
                            <img :src="u.avatarUrl" :alt="u.displayName" />
                          </div>
                          <div
                            v-else
                            class="bg-neutral text-neutral-content w-8 rounded-full flex items-center justify-center"
                          >
                            <span class="text-xs font-bold">{{ u.displayName.charAt(0).toUpperCase() }}</span>
                          </div>
                        </div>
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
      </div>

      <!-- Queue sidebar -->
      <div class="xl:col-span-1 flex flex-col gap-4">
        <div class="card bg-base-200 shadow">
          <div class="card-body gap-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-lg">Job Queues</h2>
              <RouterLink to="/admin/jobs" class="btn btn-xs btn-ghost gap-1">
                View all
                <AppIcon name="i-lucide-arrow-right" class="size-3" />
              </RouterLink>
            </div>

            <!-- Queue totals -->
            <div v-if="queueEntries.length" class="grid grid-cols-3 gap-2 text-center">
              <div class="rounded-lg bg-base-200 p-2">
                <div class="text-lg font-bold text-info">{{ totalQueueActive }}</div>
                <div class="text-[11px] text-base-content/60">Active</div>
              </div>
              <div class="rounded-lg bg-base-200 p-2">
                <div class="text-lg font-bold">{{ totalQueueWaiting }}</div>
                <div class="text-[11px] text-base-content/60">Waiting</div>
              </div>
              <div class="rounded-lg bg-base-200 p-2">
                <div class="text-lg font-bold" :class="totalQueueFailed > 0 ? 'text-error' : ''">
                  {{ totalQueueFailed }}
                </div>
                <div class="text-[11px] text-base-content/60">Failed</div>
              </div>
            </div>

            <!-- Per-queue breakdown -->
            <div v-if="queueEntries.length" class="flex flex-col gap-3">
              <div
                v-for="q in queueEntries"
                :key="q.name"
                class="rounded-lg border border-base-300 p-3"
              >
                <div class="flex items-center gap-2 mb-2">
                  <AppIcon :name="queueIcon(q.name)" class="size-4 text-primary" />
                  <span class="text-sm font-medium capitalize">{{ formatQueueName(q.name) }}</span>
                  <span v-if="q.failed > 0" class="badge badge-error badge-xs ml-auto">{{ q.failed }} failed</span>
                </div>
                <div class="grid grid-cols-4 gap-1 text-center text-[11px]">
                  <div>
                    <div class="font-semibold">{{ q.active }}</div>
                    <div class="text-base-content/50">Active</div>
                  </div>
                  <div>
                    <div class="font-semibold">{{ q.waiting }}</div>
                    <div class="text-base-content/50">Wait</div>
                  </div>
                  <div>
                    <div class="font-semibold">{{ q.delayed }}</div>
                    <div class="text-base-content/50">Delay</div>
                  </div>
                  <div>
                    <div class="font-semibold">{{ q.completed }}</div>
                    <div class="text-base-content/50">Done</div>
                  </div>
                </div>
              </div>
            </div>

            <p v-else class="text-sm text-base-content/50">No queues reported yet.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
