<script setup lang="ts">
import { api } from "~/api";
import { useToast } from "~/composables/useToast";

interface Props {
  embedded?: boolean;
}

withDefaults(defineProps<Props>(), {
  embedded: false,
});

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
const actionQueueName = ref<string | null>(null);
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

type StateColor = "info" | "neutral" | "error" | "warning" | "success";

function stateColor(state: string): StateColor {
  const map: Record<string, StateColor> = {
    active: "info",
    waiting: "neutral",
    failed: "error",
    delayed: "warning",
    completed: "success",
  };
  return map[state] ?? "neutral";
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

let eventSource: EventSource | null = null;

function connectSSE() {
  eventSource = new EventSource(apiUrl("/api/admin/jobs/stream"), {
    withCredentials: true,
  });
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
      // heartbeat
    }
  };
  eventSource.onerror = () => {
    connected.value = false;
  };
}

async function retryJob(queueName: string, jobId: string) {
  actionJobId.value = jobId;
  try {
    await api.admin.controlJob(queueName, jobId, { action: "retry" });
    toast.add({ title: "Job retried", color: "success" });
  } catch {
    toast.add({ title: "Failed to retry job", color: "error" });
  } finally {
    actionJobId.value = null;
  }
}

async function removeJob(queueName: string, jobId: string) {
  actionJobId.value = jobId;
  try {
    await api.admin.controlJob(queueName, jobId, { action: "remove" });
    toast.add({ title: "Job removed", color: "success" });
  } catch {
    toast.add({ title: "Failed to remove job", color: "error" });
  } finally {
    actionJobId.value = null;
  }
}

async function purgeQueue(queueName: string) {
  const target = formatQueueName(queueName);
  const confirmed = window.confirm(
    `Purge jobs in queue "${target}"? This removes waiting, delayed, failed, and completed jobs.`,
  );
  if (!confirmed) return;

  actionQueueName.value = queueName;
  try {
    const result = await api.admin.purgeQueue(queueName);
    toast.add({ title: `Purged ${result.total} jobs from ${target}`, color: "success" });
  } catch {
    toast.add({ title: "Failed to purge queue", color: "error" });
  } finally {
    actionQueueName.value = null;
  }
}

onMounted(() => connectSSE());
onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
});

interface StatTile {
  label: string;
  value: number;
  icon: string;
  color: string;
}

const statTiles = computed<StatTile[]>(() => [
  { label: "Active", value: totalActive.value, icon: "i-lucide-play", color: "text-info" },
  { label: "Waiting", value: totalWaiting.value, icon: "i-lucide-clock", color: "text-default" },
  {
    label: "Failed",
    value: totalFailed.value,
    icon: "i-lucide-x-circle",
    color: totalFailed.value > 0 ? "text-error" : "text-default",
  },
  { label: "Delayed", value: totalDelayed.value, icon: "i-lucide-timer", color: "text-warning" },
]);
</script>

<template>
  <div class="flex flex-col gap-6 min-h-0">
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h2 v-if="embedded" class="text-xl font-bold">Background Jobs</h2>
        <h1 v-else class="text-2xl font-bold">Background Jobs</h1>
        <p class="text-sm text-muted mt-0.5">Real-time monitoring of background task queues.</p>
      </div>
      <UBadge
        :color="connected ? 'success' : 'error'"
        variant="subtle"
        size="md"
        :icon="connected ? 'i-lucide-circle-dot' : 'i-lucide-circle-off'"
      >
        {{ connected ? "Live" : "Disconnected" }}
      </UBadge>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <UCard v-for="tile in statTiles" :key="tile.label" :ui="{ body: 'p-4' }">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs text-muted uppercase tracking-wide">{{ tile.label }}</p>
            <p class="text-3xl font-bold mt-1" :class="tile.color">{{ tile.value }}</p>
          </div>
          <UIcon :name="tile.icon" class="size-6" :class="tile.color" />
        </div>
      </UCard>
    </div>

    <UCard v-if="queues.length" :ui="{ body: 'p-0 overflow-auto max-h-[24rem]' }">
      <table class="w-full text-sm">
        <thead class="bg-elevated/60">
          <tr class="text-left">
            <th class="px-4 py-3 font-medium">Queue</th>
            <th class="px-4 py-3 font-medium text-right">Active</th>
            <th class="px-4 py-3 font-medium text-right">Waiting</th>
            <th class="px-4 py-3 font-medium text-right">Delayed</th>
            <th class="px-4 py-3 font-medium text-right">Failed</th>
            <th class="px-4 py-3 font-medium text-right">Completed</th>
            <th class="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr
            v-for="q in queues"
            :key="q.name"
            class="hover:bg-elevated/40 cursor-pointer"
            @click="queueFilter = queueFilter === q.name ? 'all' : q.name"
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <UIcon :name="queueIcon(q.name)" class="size-4 text-primary" />
                <span class="font-medium capitalize">{{ formatQueueName(q.name) }}</span>
                <UBadge v-if="queueFilter === q.name" color="primary" size="xs">filtered</UBadge>
              </div>
            </td>
            <td class="px-4 py-3 text-right text-info font-medium">{{ q.active }}</td>
            <td class="px-4 py-3 text-right font-medium">{{ q.waiting }}</td>
            <td class="px-4 py-3 text-right text-warning font-medium">{{ q.delayed }}</td>
            <td class="px-4 py-3 text-right font-medium" :class="q.failed > 0 ? 'text-error' : ''">
              {{ q.failed }}
            </td>
            <td class="px-4 py-3 text-right text-success font-medium">{{ q.completed }}</td>
            <td class="px-4 py-3 text-right" @click.stop>
              <UButton
                color="error"
                variant="soft"
                size="xs"
                icon="i-lucide-trash-2"
                :loading="actionQueueName === q.name"
                @click="purgeQueue(q.name)"
              >
                Purge
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </UCard>

    <UCard :ui="{ body: 'p-0 overflow-auto max-h-[40rem]' }">
      <template #header>
        <div class="flex items-center gap-3 flex-wrap">
          <h3 class="text-lg font-semibold flex-1">Jobs</h3>
          <USelect v-model="queueFilter" :items="queueOptions" size="sm" class="w-40" />
          <USelect v-model="statusFilter" :items="statusOptions" size="sm" class="w-36" />
          <UBadge color="neutral" variant="subtle">
            {{ filteredJobs.length }} {{ filteredJobs.length === 1 ? "job" : "jobs" }}
          </UBadge>
        </div>
      </template>

      <div v-if="!connected && jobs.length === 0" class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="sortedJobs.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-elevated/60">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="px-4 py-3 font-medium">Type</th>
              <th class="px-4 py-3 font-medium">Queue</th>
              <th class="px-4 py-3 font-medium">Progress</th>
              <th class="px-4 py-3 font-medium">Attempts</th>
              <th class="px-4 py-3 font-medium">Created</th>
              <th class="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <template v-for="job in sortedJobs" :key="`${job.queueName}-${job.id}`">
              <tr class="hover:bg-elevated/40 cursor-pointer" @click="toggleJobExpand(job.id)">
                <td class="px-4 py-3">
                  <UBadge
                    :color="stateColor(job.state)"
                    variant="soft"
                    size="sm"
                    :icon="stateIcon(job.state)"
                  >
                    {{ job.state }}
                  </UBadge>
                </td>
                <td class="px-4 py-3 font-medium">{{ jobType(job) }}</td>
                <td class="px-4 py-3 text-muted capitalize">
                  {{ formatQueueName(job.queueName) }}
                </td>
                <td class="px-4 py-3 min-w-[120px]">
                  <div v-if="job.state === 'active'" class="flex items-center gap-2">
                    <UProgress
                      :model-value="jobProgress(job)"
                      color="info"
                      size="sm"
                      class="w-20"
                    />
                    <span class="text-xs text-muted">{{ jobProgress(job) }}%</span>
                  </div>
                  <span v-else-if="job.state === 'failed'" class="text-xs text-error">Failed</span>
                  <span v-else class="text-xs text-muted">—</span>
                </td>
                <td class="px-4 py-3">{{ job.attemptsMade }}</td>
                <td class="px-4 py-3 text-xs text-muted whitespace-nowrap">
                  {{ formatTimestamp(job.timestamp) }}
                </td>
                <td class="px-4 py-3 text-right" @click.stop>
                  <div v-if="job.state === 'failed'" class="flex items-center justify-end gap-1">
                    <UTooltip text="Retry">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        square
                        icon="i-lucide-rotate-cw"
                        :loading="actionJobId === job.id"
                        @click="retryJob(job.queueName, job.id)"
                      />
                    </UTooltip>
                    <UTooltip text="Remove">
                      <UButton
                        color="error"
                        variant="ghost"
                        size="xs"
                        square
                        icon="i-lucide-trash-2"
                        :loading="actionJobId === job.id"
                        @click="removeJob(job.queueName, job.id)"
                      />
                    </UTooltip>
                  </div>
                </td>
              </tr>
              <tr v-if="expandedJobId === job.id" class="bg-elevated/40">
                <td colspan="7">
                  <div class="p-3 text-xs space-y-2">
                    <div v-if="job.failedReason" class="flex gap-2">
                      <span class="font-semibold text-error shrink-0">Error:</span>
                      <code class="text-error/80 break-all">{{ job.failedReason }}</code>
                    </div>
                    <div class="flex gap-2">
                      <span class="font-semibold shrink-0">Job ID:</span>
                      <code class="text-muted">{{ job.id }}</code>
                    </div>
                    <div v-if="job.data && Object.keys(job.data).length" class="flex gap-2">
                      <span class="font-semibold shrink-0">Payload:</span>
                      <code class="text-muted break-all">{{ JSON.stringify(job.data) }}</code>
                    </div>
                    <div class="flex gap-4 text-muted">
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
        <UIcon name="i-lucide-inbox" class="size-8 text-muted" />
        <p class="text-sm text-muted">No jobs matching current filters.</p>
      </div>
    </UCard>
  </div>
</template>
