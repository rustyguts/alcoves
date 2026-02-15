<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { apiFetch } from "~/utils/api-fetch";
import { formatFileSize } from "~/utils/mime-icons";

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

interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface JobStats {
  queues: QueueStat[];
  configured: boolean;
}

interface FailedJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  attemptsMade: number;
  failedReason: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
}

const toast = useToast();
const { user: currentUser } = useAuth();

const {
  data: stats,
  status: statsStatus,
  refresh: refreshStats,
} = useApiFetch<AdminStats>("/api/admin/stats");
const {
  data: users,
  status: usersStatus,
  refresh: refreshUsers,
} = useApiFetch<AdminUser[]>("/api/admin/users");

const jobStats = ref<JobStats | null>(null);
const failedJobs = ref<FailedJob[]>([]);
const failedJobsQueue = ref<string | null>(null);
const jobsLoading = ref(false);
const actionJobId = ref<string | null>(null);

async function fetchJobStats() {
  try {
    jobStats.value = await apiFetch<JobStats>("/api/admin/jobs/stats");
  } catch {
    // Queue not configured, ignore
  }
}

async function fetchFailedJobs(queueName: string) {
  failedJobsQueue.value = queueName;
  jobsLoading.value = true;
  try {
    const result = await apiFetch<{ jobs: FailedJob[] }>(
      `/api/admin/jobs/${encodeURIComponent(queueName)}`,
      { query: { status: "failed" } },
    );
    failedJobs.value = result.jobs;
  } catch {
    toast.add({ title: "Failed to load jobs", color: "error" });
  } finally {
    jobsLoading.value = false;
  }
}

async function retryJob(queueName: string, jobId: string) {
  actionJobId.value = jobId;
  try {
    await apiFetch(`/api/admin/jobs/${encodeURIComponent(queueName)}/${jobId}`, {
      method: "POST",
      body: { action: "retry" },
    });
    toast.add({ title: "Job retried" });
    await fetchFailedJobs(queueName);
    await fetchJobStats();
  } catch {
    toast.add({ title: "Failed to retry job", color: "error" });
  } finally {
    actionJobId.value = null;
  }
}

async function removeJob(queueName: string, jobId: string) {
  actionJobId.value = jobId;
  try {
    await apiFetch(`/api/admin/jobs/${encodeURIComponent(queueName)}/${jobId}`, {
      method: "POST",
      body: { action: "remove" },
    });
    toast.add({ title: "Job removed" });
    await fetchFailedJobs(queueName);
    await fetchJobStats();
  } catch {
    toast.add({ title: "Failed to remove job", color: "error" });
  } finally {
    actionJobId.value = null;
  }
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

function formatTimestamp(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("en-US", {
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
    const updated = await apiFetch<{ id: string; role: AdminUser["role"] }>(
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
  await Promise.all([refreshStats(), refreshUsers(), fetchJobStats()]);
}

// Fetch job stats on mount and auto-refresh
let jobRefreshInterval: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  fetchJobStats();
  jobRefreshInterval = setInterval(fetchJobStats, 10_000);
});

onUnmounted(() => {
  if (jobRefreshInterval) clearInterval(jobRefreshInterval);
});
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
          <div
            class="size-9 rounded-md bg-primary/10 text-primary flex items-center justify-center"
          >
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
              <td class="px-4 py-3 text-sm">
                {{ user.uploadedFileCount.toLocaleString("en-US") }}
              </td>
              <td class="px-4 py-3 text-sm">{{ formatDateTime(user.lastLoggedInAt) }}</td>
              <td class="px-4 py-3 text-sm text-muted">{{ formatDateTime(user.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="p-6 text-sm text-muted">No users found.</div>
    </UCard>

    <section v-if="jobStats?.configured" class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Job Queues</h2>
        <UButton
          label="View All Jobs"
          icon="i-lucide-arrow-right"
          trailing
          variant="outline"
          color="neutral"
          size="sm"
          to="/admin/jobs"
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <UCard
          v-for="queue in jobStats.queues"
          :key="queue.name"
          :ui="{ body: 'p-4' }"
          class="border border-default bg-elevated/40 cursor-pointer hover:bg-elevated/60 transition-colors"
          @click="queue.failed > 0 ? fetchFailedJobs(queue.name) : undefined"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-sm font-medium capitalize">{{ formatQueueName(queue.name) }}</p>
              <div class="flex items-center gap-3 mt-2 text-xs text-muted">
                <span>Waiting: {{ queue.waiting }}</span>
                <span>Active: {{ queue.active }}</span>
                <span :class="queue.failed > 0 ? 'text-error font-medium' : ''">
                  Failed: {{ queue.failed }}
                </span>
              </div>
            </div>
            <div
              class="size-9 rounded-md bg-primary/10 text-primary flex items-center justify-center"
            >
              <UIcon :name="queueIcon(queue.name)" class="size-5" />
            </div>
          </div>
        </UCard>
      </div>

      <UCard v-if="failedJobsQueue" :ui="{ body: 'p-0' }">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-semibold capitalize">
                {{ formatQueueName(failedJobsQueue) }} - Failed Jobs
              </h3>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="
                failedJobsQueue = null;
                failedJobs = [];
              "
            />
          </div>
        </template>

        <div v-if="jobsLoading" class="flex items-center justify-center py-8">
          <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
        </div>

        <div v-else-if="failedJobs.length" class="overflow-x-auto">
          <table class="min-w-full">
            <thead>
              <tr class="border-b border-default bg-elevated/40">
                <th class="px-4 py-3 text-left text-xs font-medium text-muted">Job</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-muted">Error</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-muted">Attempts</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-muted">Time</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="job in failedJobs"
                :key="job.id"
                class="border-b border-default/70 last:border-b-0"
              >
                <td class="px-4 py-3 text-sm">{{ job.name }}</td>
                <td class="px-4 py-3 text-sm text-error max-w-xs truncate">
                  {{ job.failedReason ?? "-" }}
                </td>
                <td class="px-4 py-3 text-sm">{{ job.attemptsMade }}</td>
                <td class="px-4 py-3 text-sm text-muted">
                  {{ formatTimestamp(job.timestamp) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <UButton
                      icon="i-lucide-rotate-cw"
                      color="primary"
                      variant="soft"
                      size="xs"
                      title="Retry"
                      :loading="actionJobId === job.id"
                      @click="retryJob(failedJobsQueue!, job.id)"
                    />
                    <UButton
                      icon="i-lucide-trash-2"
                      color="error"
                      variant="soft"
                      size="xs"
                      title="Remove"
                      :loading="actionJobId === job.id"
                      @click="removeJob(failedJobsQueue!, job.id)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="p-6 text-sm text-muted text-center">No failed jobs.</div>
      </UCard>
    </section>
  </div>
</template>
