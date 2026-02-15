<script setup lang="ts">
import { apiFetch } from "~/utils/api-fetch";

interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface JobEntry {
  id: string;
  queueName: string;
  name: string;
  data: Record<string, unknown>;
  progress: number | object;
  attemptsMade: number;
  failedReason: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  state: string;
}

interface StreamSnapshot {
  queues: QueueStat[];
  jobs: JobEntry[];
}

const toast = useToast();

const queues = ref<QueueStat[]>([]);
const jobs = ref<JobEntry[]>([]);
const connected = ref(false);
const statusFilter = ref("all");
const queueFilter = ref("all");
const actionJobId = ref<string | null>(null);

const statusOptions = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Waiting", value: "waiting" },
  { label: "Failed", value: "failed" },
  { label: "Delayed", value: "delayed" },
];

const queueOptions = computed(() => {
  const options = [{ label: "All Queues", value: "all" }];
  for (const q of queues.value) {
    options.push({ label: formatQueueName(q.name), value: q.name });
  }
  return options;
});

const filteredJobs = computed(() => {
  return jobs.value.filter((job) => {
    if (statusFilter.value !== "all" && job.state !== statusFilter.value) return false;
    if (queueFilter.value !== "all" && job.queueName !== queueFilter.value) return false;
    return true;
  });
});

const sortedJobs = computed(() => {
  return [...filteredJobs.value].sort((a, b) => {
    // Active jobs first, then by timestamp desc
    const stateOrder: Record<string, number> = { active: 0, waiting: 1, delayed: 2, failed: 3 };
    const aOrder = stateOrder[a.state] ?? 4;
    const bOrder = stateOrder[b.state] ?? 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.timestamp - a.timestamp;
  });
});

function formatQueueName(name: string): string {
  return name.replace(/^\{|\}$/g, "").replace(/-/g, " ");
}

function queueIcon(name: string): string {
  if (name.includes("face")) return "i-lucide-scan-face";
  if (name.includes("video")) return "i-lucide-video";
  if (name.includes("thumbnail")) return "i-lucide-image";
  return "i-lucide-layers";
}

function jobProgress(job: JobEntry): number {
  if (typeof job.progress === "number") return job.progress;
  return 0;
}

type BadgeColor = "primary" | "secondary" | "success" | "info" | "warning" | "error" | "neutral";

function stateColor(state: string): BadgeColor {
  switch (state) {
    case "active":
      return "primary";
    case "waiting":
      return "neutral";
    case "failed":
      return "error";
    case "delayed":
      return "warning";
    default:
      return "neutral";
  }
}

function stateIcon(state: string): string {
  switch (state) {
    case "active":
      return "i-lucide-play";
    case "waiting":
      return "i-lucide-clock";
    case "failed":
      return "i-lucide-x-circle";
    case "delayed":
      return "i-lucide-timer";
    default:
      return "i-lucide-circle";
  }
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function jobLibraryId(job: JobEntry): string | null {
  return (job.data?.libraryId as string) ?? null;
}

function jobType(job: JobEntry): string {
  return job.name || formatQueueName(job.queueName);
}

let eventSource: EventSource | null = null;

function connectSSE() {
  eventSource = new EventSource("/api/admin/jobs/stream");

  eventSource.onopen = () => {
    connected.value = true;
  };

  eventSource.onmessage = (event) => {
    try {
      const snapshot: StreamSnapshot = JSON.parse(event.data);
      queues.value = snapshot.queues;
      jobs.value = snapshot.jobs;
      connected.value = true;
    } catch {
      // Ignore parse errors
    }
  };

  eventSource.onerror = () => {
    connected.value = false;
    // EventSource auto-reconnects
  };
}

async function retryJob(queueName: string, jobId: string) {
  actionJobId.value = jobId;
  try {
    await apiFetch(`/api/admin/jobs/${encodeURIComponent(queueName)}/${jobId}`, {
      method: "POST",
      body: { action: "retry" },
    });
    toast.add({ title: "Job retried" });
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
  } catch {
    toast.add({ title: "Failed to remove job", color: "error" });
  } finally {
    actionJobId.value = null;
  }
}

onMounted(() => {
  connectSSE();
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
});
</script>

<template>
  <div class="mx-auto max-w-7xl flex flex-col gap-6">
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-arrow-left"
            variant="ghost"
            color="neutral"
            size="sm"
            to="/admin"
          />
          <h1 class="text-xl font-semibold">Background Jobs</h1>
        </div>
        <p class="text-sm text-muted mt-1">Monitor and manage background job queues in realtime.</p>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="flex items-center gap-1.5 text-xs"
          :class="connected ? 'text-success' : 'text-error'"
        >
          <span class="size-2 rounded-full" :class="connected ? 'bg-success' : 'bg-error'" />
          {{ connected ? "Connected" : "Disconnected" }}
        </span>
      </div>
    </div>

    <!-- Queue stat cards -->
    <section class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <UCard
        v-for="queue in queues"
        :key="queue.name"
        :ui="{ body: 'p-4' }"
        class="border border-default bg-elevated/40"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-sm font-medium capitalize">{{ formatQueueName(queue.name) }}</p>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted">
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-play" class="size-3 text-primary" />
                Active: {{ queue.active }}
              </span>
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-clock" class="size-3" />
                Waiting: {{ queue.waiting }}
              </span>
              <span
                class="flex items-center gap-1"
                :class="queue.failed > 0 ? 'text-error font-medium' : ''"
              >
                <UIcon name="i-lucide-x-circle" class="size-3" />
                Failed: {{ queue.failed }}
              </span>
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-timer" class="size-3 text-warning" />
                Delayed: {{ queue.delayed }}
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
    </section>

    <!-- Filters -->
    <div class="flex items-center gap-3 flex-wrap">
      <USelectMenu
        v-model="statusFilter"
        :items="statusOptions"
        value-key="value"
        class="w-36"
        placeholder="Status"
      />
      <USelectMenu
        v-model="queueFilter"
        :items="queueOptions"
        value-key="value"
        class="w-48"
        placeholder="Queue"
      />
      <span class="text-xs text-muted ml-auto">
        {{ filteredJobs.length }} {{ filteredJobs.length === 1 ? "job" : "jobs" }}
      </span>
    </div>

    <!-- Jobs table -->
    <UCard :ui="{ body: 'p-0' }">
      <template #header>
        <h2 class="text-lg font-semibold">Jobs</h2>
      </template>

      <div v-if="!connected && jobs.length === 0" class="flex items-center justify-center py-10">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>

      <div v-else-if="sortedJobs.length" class="overflow-x-auto">
        <table class="min-w-full">
          <thead>
            <tr class="border-b border-default bg-elevated/40">
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Status</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Job Type</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Queue</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Library</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Progress</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Error</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Attempts</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-muted">Created</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="job in sortedJobs"
              :key="`${job.queueName}-${job.id}`"
              class="border-b border-default/70 last:border-b-0 hover:bg-elevated/30 transition-colors"
            >
              <td class="px-4 py-3">
                <UBadge :color="stateColor(job.state)" variant="soft" size="xs">
                  <UIcon :name="stateIcon(job.state)" class="size-3 mr-1" />
                  {{ job.state }}
                </UBadge>
              </td>
              <td class="px-4 py-3 text-sm font-medium">{{ jobType(job) }}</td>
              <td class="px-4 py-3 text-sm text-muted capitalize">
                {{ formatQueueName(job.queueName) }}
              </td>
              <td class="px-4 py-3 text-sm">
                <code v-if="jobLibraryId(job)" class="text-xs bg-elevated px-1.5 py-0.5 rounded">
                  {{ jobLibraryId(job)!.slice(0, 8) }}
                </code>
                <span v-else class="text-muted">-</span>
              </td>
              <td class="px-4 py-3 min-w-[120px]">
                <div v-if="job.state === 'active'" class="flex items-center gap-2">
                  <UProgress :value="jobProgress(job)" size="sm" class="flex-1" />
                  <span class="text-xs text-muted whitespace-nowrap">{{ jobProgress(job) }}%</span>
                </div>
                <span v-else-if="job.state === 'failed'" class="text-xs text-error">Failed</span>
                <span v-else class="text-xs text-muted">-</span>
              </td>
              <td class="px-4 py-3 text-sm text-error max-w-xs truncate">
                {{ job.failedReason ?? "-" }}
              </td>
              <td class="px-4 py-3 text-sm">{{ job.attemptsMade }}</td>
              <td class="px-4 py-3 text-sm text-muted whitespace-nowrap">
                {{ formatTimestamp(job.timestamp) }}
              </td>
              <td class="px-4 py-3 text-right">
                <div v-if="job.state === 'failed'" class="flex items-center justify-end gap-1">
                  <UButton
                    icon="i-lucide-rotate-cw"
                    color="primary"
                    variant="soft"
                    size="xs"
                    title="Retry"
                    :loading="actionJobId === job.id"
                    @click="retryJob(job.queueName, job.id)"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="soft"
                    size="xs"
                    title="Remove"
                    :loading="actionJobId === job.id"
                    @click="removeJob(job.queueName, job.id)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="p-6 text-sm text-muted text-center">No jobs matching current filters.</div>
    </UCard>
  </div>
</template>
