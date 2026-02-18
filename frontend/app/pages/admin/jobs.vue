<script setup lang="ts">
import { apiFetch } from "~/utils/api-fetch";
import { useToast } from "~/composables/useToast";
import AppIcon from "~/components/AppIcon.vue";

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
const expandedJobId = ref<string | null>(null);

const statusOptions = [
  { label: "All statuses", value: "all" },
  { label: "Active", value: "active" },
  { label: "Waiting", value: "waiting" },
  { label: "Failed", value: "failed" },
  { label: "Delayed", value: "delayed" },
];

const queueOptions = computed(() => {
  const opts = [{ label: "All queues", value: "all" }];
  for (const q of queues.value) {
    opts.push({ label: formatQueueName(q.name), value: q.name });
  }
  return opts;
});

const filteredJobs = computed(() =>
  jobs.value.filter((job) => {
    if (statusFilter.value !== "all" && job.state !== statusFilter.value) return false;
    if (queueFilter.value !== "all" && job.queueName !== queueFilter.value) return false;
    return true;
  }),
);

const sortedJobs = computed(() => {
  const order: Record<string, number> = { active: 0, waiting: 1, delayed: 2, failed: 3 };
  return [...filteredJobs.value].sort((a, b) => {
    const ao = order[a.state] ?? 4;
    const bo = order[b.state] ?? 4;
    if (ao !== bo) return ao - bo;
    return b.timestamp - a.timestamp;
  });
});

const totalActive = computed(() => queues.value.reduce((s, q) => s + q.active, 0));
const totalWaiting = computed(() => queues.value.reduce((s, q) => s + q.waiting, 0));
const totalFailed = computed(() => queues.value.reduce((s, q) => s + q.failed, 0));
const totalDelayed = computed(() => queues.value.reduce((s, q) => s + q.delayed, 0));

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
  return typeof job.progress === "number" ? job.progress : 0;
}

type BadgeVariant = "badge-info" | "badge-ghost" | "badge-error" | "badge-warning" | "badge-success";

function stateVariant(state: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    active: "badge-info",
    waiting: "badge-ghost",
    failed: "badge-error",
    delayed: "badge-warning",
    completed: "badge-success",
  };
  return map[state] ?? "badge-ghost";
}

function stateIcon(state: string): string {
  const map: Record<string, string> = {
    active: "i-lucide-play",
    waiting: "i-lucide-clock",
    failed: "i-lucide-x-circle",
    delayed: "i-lucide-timer",
    completed: "i-lucide-check-circle",
  };
  return map[state] ?? "i-lucide-circle";
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function jobType(job: JobEntry): string {
  return job.name || formatQueueName(job.queueName);
}

function toggleJobExpand(jobId: string) {
  expandedJobId.value = expandedJobId.value === jobId ? null : jobId;
}

// SSE connection
let eventSource: EventSource | null = null;

function connectSSE() {
  eventSource = new EventSource("/api/admin/jobs/stream");
  eventSource.onopen = () => {
    connected.value = true;
  };
  eventSource.onmessage = (event) => {
    try {
      const snapshot: StreamSnapshot = JSON.parse(event.data);
      if (snapshot.queues) queues.value = snapshot.queues;
      if (snapshot.jobs) jobs.value = snapshot.jobs;
      connected.value = true;
    } catch {
      // Ignore non-snapshot messages (heartbeats, connected events)
    }
  };
  eventSource.onerror = () => {
    connected.value = false;
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

onMounted(() => connectSSE());
onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
});
</script>

<template>
  <div class="flex flex-col gap-6 overflow-y-auto flex-1 min-h-0">
    <!-- Header -->
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3">
        <RouterLink to="/admin" class="btn btn-sm btn-ghost btn-square">
          <AppIcon name="i-lucide-arrow-left" class="size-4" />
        </RouterLink>
        <div>
          <h1 class="text-2xl font-bold">Background Jobs</h1>
          <p class="text-sm text-base-content/60 mt-0.5">
            Real-time monitoring of background task queues.
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="badge badge-sm gap-1.5"
          :class="connected ? 'badge-success badge-outline' : 'badge-error badge-outline'"
        >
          <span class="size-1.5 rounded-full" :class="connected ? 'bg-success' : 'bg-error'" />
          {{ connected ? "Live" : "Disconnected" }}
        </span>
      </div>
    </div>

    <!-- Summary stats -->
    <div class="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-200">
      <div class="stat">
        <div class="stat-figure text-info"><AppIcon name="i-lucide-play" class="size-5" /></div>
        <div class="stat-title">Active</div>
        <div class="stat-value text-info text-2xl">{{ totalActive }}</div>
      </div>
      <div class="stat">
        <div class="stat-figure"><AppIcon name="i-lucide-clock" class="size-5" /></div>
        <div class="stat-title">Waiting</div>
        <div class="stat-value text-2xl">{{ totalWaiting }}</div>
      </div>
      <div class="stat">
        <div class="stat-figure" :class="totalFailed > 0 ? 'text-error' : ''">
          <AppIcon name="i-lucide-x-circle" class="size-5" />
        </div>
        <div class="stat-title">Failed</div>
        <div class="stat-value text-2xl" :class="totalFailed > 0 ? 'text-error' : ''">{{ totalFailed }}</div>
      </div>
      <div class="stat">
        <div class="stat-figure text-warning"><AppIcon name="i-lucide-timer" class="size-5" /></div>
        <div class="stat-title">Delayed</div>
        <div class="stat-value text-2xl">{{ totalDelayed }}</div>
      </div>
    </div>

    <!-- Per-queue breakdown cards -->
    <div v-if="queues.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      <div
        v-for="q in queues"
        :key="q.name"
        class="card bg-base-200 shadow-sm border border-base-300 hover:border-primary/30 transition-colors cursor-pointer"
        @click="queueFilter = queueFilter === q.name ? 'all' : q.name"
      >
        <div class="card-body p-4 gap-3">
          <div class="flex items-center gap-2">
            <div class="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <AppIcon :name="queueIcon(q.name)" class="size-4" />
            </div>
            <span class="text-sm font-semibold capitalize flex-1">{{ formatQueueName(q.name) }}</span>
            <span v-if="queueFilter === q.name" class="badge badge-primary badge-xs">filtered</span>
          </div>
          <div class="grid grid-cols-4 gap-1 text-center text-xs">
            <div>
              <div class="font-bold text-info">{{ q.active }}</div>
              <div class="text-base-content/50">Active</div>
            </div>
            <div>
              <div class="font-bold">{{ q.waiting }}</div>
              <div class="text-base-content/50">Wait</div>
            </div>
            <div>
              <div class="font-bold" :class="q.failed > 0 ? 'text-error' : ''">{{ q.failed }}</div>
              <div class="text-base-content/50">Fail</div>
            </div>
            <div>
              <div class="font-bold text-warning">{{ q.delayed }}</div>
              <div class="text-base-content/50">Delay</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Filters + job table -->
    <div class="card bg-base-200 shadow">
      <div class="card-body p-0">
        <!-- Toolbar -->
        <div class="flex items-center gap-3 flex-wrap px-4 pt-4 pb-2">
          <h2 class="card-title text-lg flex-1">Jobs</h2>
          <select v-model="queueFilter" class="select select-sm select-bordered w-40">
            <option v-for="o in queueOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <select v-model="statusFilter" class="select select-sm select-bordered w-36">
            <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <span class="badge badge-ghost badge-sm">
            {{ filteredJobs.length }} {{ filteredJobs.length === 1 ? "job" : "jobs" }}
          </span>
        </div>

        <!-- Table -->
        <div v-if="!connected && jobs.length === 0" class="flex justify-center py-16">
          <span class="loading loading-dots loading-md" />
        </div>

        <div v-else-if="sortedJobs.length" class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Status</th>
                <th>Type</th>
                <th>Queue</th>
                <th>Progress</th>
                <th>Attempts</th>
                <th>Created</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="job in sortedJobs" :key="`${job.queueName}-${job.id}`">
                <tr
                  class="hover cursor-pointer"
                  @click="toggleJobExpand(job.id)"
                >
                  <td>
                    <span class="badge badge-sm badge-soft gap-1" :class="stateVariant(job.state)">
                      <AppIcon :name="stateIcon(job.state)" class="size-3" />
                      {{ job.state }}
                    </span>
                  </td>
                  <td class="font-medium text-sm">{{ jobType(job) }}</td>
                  <td class="text-sm text-base-content/60 capitalize">{{ formatQueueName(job.queueName) }}</td>
                  <td class="min-w-[120px]">
                    <div v-if="job.state === 'active'" class="flex items-center gap-2">
                      <progress class="progress progress-info w-20" :value="jobProgress(job)" max="100" />
                      <span class="text-xs text-base-content/60">{{ jobProgress(job) }}%</span>
                    </div>
                    <span v-else-if="job.state === 'failed'" class="text-xs text-error">Failed</span>
                    <span v-else class="text-xs text-base-content/40">—</span>
                  </td>
                  <td class="text-sm">{{ job.attemptsMade }}</td>
                  <td class="text-xs text-base-content/60 whitespace-nowrap">{{ formatTimestamp(job.timestamp) }}</td>
                  <td class="text-right" @click.stop>
                    <div v-if="job.state === 'failed'" class="flex items-center justify-end gap-1">
                      <button
                        class="btn btn-xs btn-ghost btn-square tooltip tooltip-left"
                        data-tip="Retry"
                        :disabled="actionJobId === job.id"
                        @click="retryJob(job.queueName, job.id)"
                      >
                        <span v-if="actionJobId === job.id" class="loading loading-spinner loading-xs" />
                        <AppIcon v-else name="i-lucide-rotate-cw" class="size-3.5" />
                      </button>
                      <button
                        class="btn btn-xs btn-ghost btn-square text-error tooltip tooltip-left"
                        data-tip="Remove"
                        :disabled="actionJobId === job.id"
                        @click="removeJob(job.queueName, job.id)"
                      >
                        <span v-if="actionJobId === job.id" class="loading loading-spinner loading-xs" />
                        <AppIcon v-else name="i-lucide-trash-2" class="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                <!-- Expanded detail row -->
                <tr v-if="expandedJobId === job.id" class="bg-base-200/50">
                  <td colspan="7">
                    <div class="p-3 text-xs space-y-2">
                      <div v-if="job.failedReason" class="flex gap-2">
                        <span class="font-semibold text-error shrink-0">Error:</span>
                        <code class="text-error/80 break-all">{{ job.failedReason }}</code>
                      </div>
                      <div class="flex gap-2">
                        <span class="font-semibold shrink-0">Job ID:</span>
                        <code class="text-base-content/70">{{ job.id }}</code>
                      </div>
                      <div v-if="job.data && Object.keys(job.data).length" class="flex gap-2">
                        <span class="font-semibold shrink-0">Payload:</span>
                        <code class="text-base-content/70 break-all">{{ JSON.stringify(job.data) }}</code>
                      </div>
                      <div class="flex gap-4 text-base-content/60">
                        <span>Processed: {{ formatTimestamp(job.processedOn) }}</span>
                        <span>Finished: {{ formatTimestamp(job.finishedOn) }}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div v-else class="flex flex-col items-center justify-center py-16 gap-2">
          <AppIcon name="i-lucide-inbox" class="size-8 text-base-content/30" />
          <p class="text-sm text-base-content/50">No jobs matching current filters.</p>
        </div>
      </div>
    </div>
  </div>
</template>
