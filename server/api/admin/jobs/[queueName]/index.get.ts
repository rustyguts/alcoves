import type { QueueName } from "~~/server/utils/queue";

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  const queueName = getRouterParam(event, "queueName")! as QueueName;
  const query = getQuery(event);
  const status = (query.status as string) || "failed";
  const page = Number(query.page) || 0;
  const pageSize = 20;

  if (!isQueueConfigured()) {
    return { jobs: [], total: 0 };
  }

  const queue = getQueue(queueName);
  const start = page * pageSize;
  const end = start + pageSize - 1;

  let jobs;
  switch (status) {
    case "failed":
      jobs = await queue.getFailed(start, end);
      break;
    case "waiting":
      jobs = await queue.getWaiting(start, end);
      break;
    case "active":
      jobs = await queue.getActive(start, end);
      break;
    case "delayed":
      jobs = await queue.getDelayed(start, end);
      break;
    default:
      jobs = await queue.getFailed(start, end);
  }

  const total =
    status === "failed"
      ? await queue.getFailedCount()
      : status === "waiting"
        ? await queue.getWaitingCount()
        : status === "active"
          ? await queue.getActiveCount()
          : await queue.getDelayedCount();

  return {
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    })),
    total,
  };
});
