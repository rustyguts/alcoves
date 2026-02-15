import type { QueueName } from "~~/server/utils/queue";

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  if (!isQueueConfigured()) {
    throw createError({ statusCode: 503, statusMessage: "Queue not configured" });
  }

  setResponseHeader(event, "Content-Type", "text/event-stream");
  setResponseHeader(event, "Cache-Control", "no-cache");
  setResponseHeader(event, "Connection", "keep-alive");

  const queueNames: QueueName[] = ["{face-detection}", "{video-processing}", "{thumbnails}"];

  const sendEvent = (data: unknown) => {
    event.node.res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const fetchSnapshot = async () => {
    const queues = await getAllQueueStats();

    const allJobs = [];
    for (const queueName of queueNames) {
      const queue = getQueue(queueName);
      const [active, waiting, failed, delayed] = await Promise.all([
        queue.getActive(0, 49),
        queue.getWaiting(0, 49),
        queue.getFailed(0, 49),
        queue.getDelayed(0, 49),
      ]);

      for (const job of [...active, ...waiting, ...failed, ...delayed]) {
        const state = await job.getState();
        allJobs.push({
          id: job.id,
          queueName,
          name: job.name,
          data: job.data,
          progress: job.progress,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
          timestamp: job.timestamp,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
          state,
        });
      }
    }

    return { queues, jobs: allJobs };
  };

  // Send initial snapshot
  const initial = await fetchSnapshot();
  sendEvent(initial);

  // Poll for updates every 2 seconds
  const interval = setInterval(async () => {
    try {
      const snapshot = await fetchSnapshot();
      sendEvent(snapshot);
    } catch {
      // Connection may be closed
      clearInterval(interval);
    }
  }, 2000);

  // Clean up on close
  event._handled = true;
  event.node.req.on("close", () => {
    clearInterval(interval);
  });
});
