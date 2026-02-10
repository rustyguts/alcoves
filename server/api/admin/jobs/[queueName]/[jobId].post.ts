import type { QueueName } from "~~/server/utils/queue";

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  const queueName = getRouterParam(event, "queueName")! as QueueName;
  const jobId = getRouterParam(event, "jobId")!;
  const body = await readBody<{ action: "retry" | "remove" }>(event);

  if (!body?.action || !["retry", "remove"].includes(body.action)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid action" });
  }

  if (!isQueueConfigured()) {
    throw createError({ statusCode: 503, statusMessage: "Queue not configured" });
  }

  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);

  if (!job) {
    throw createError({ statusCode: 404, statusMessage: "Job not found" });
  }

  if (body.action === "retry") {
    await job.retry();
    return { success: true, action: "retry" };
  }

  await job.remove();
  return { success: true, action: "remove" };
});
