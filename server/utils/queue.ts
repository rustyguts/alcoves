import { Queue } from "bullmq";
import type { ConnectionOptions, JobsOptions } from "bullmq";

export type QueueName = "{face-detection}" | "{video-processing}" | "{thumbnails}";

const queues = new Map<QueueName, Queue>();

export function getQueueConnection(): ConnectionOptions {
  const config = useRuntimeConfig();
  return {
    host: config.queue.redisHost,
    port: config.queue.redisPort,
    password: config.queue.redisPassword || undefined,
  };
}

export function isQueueConfigured(): boolean {
  const config = useRuntimeConfig();
  return Boolean(config.queue.redisHost);
}

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (queue) return queue;

  queue = new Queue(name, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });

  queues.set(name, queue);
  return queue;
}

export async function enqueueJob(
  queueName: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  options?: JobsOptions,
): Promise<void> {
  const queue = getQueue(queueName);
  await queue.add(jobName, data, options);
}

export async function getQueueStats(queueName: QueueName) {
  const queue = getQueue(queueName);
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { name: queueName, waiting, active, completed, failed, delayed };
}

export async function getAllQueueStats() {
  const names: QueueName[] = ["{face-detection}", "{video-processing}", "{thumbnails}"];
  return Promise.all(names.map(getQueueStats));
}

export async function closeAllQueues(): Promise<void> {
  for (const queue of queues.values()) {
    await queue.close();
  }
  queues.clear();
}
