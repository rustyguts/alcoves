import { Worker } from "bullmq";
import type { Job } from "bullmq";

const workers: Worker[] = [];

export default defineNitroPlugin(async (nitro) => {
  if (!isQueueConfigured()) {
    console.log("[queue] No queue host configured, skipping worker startup");
    return;
  }

  const connection = getQueueConnection();

  const faceDetectionWorker = new Worker(
    "{face-detection}",
    async (job: Job) => {
      const { processFaceDetectionJob } = await import("~~/server/services/face-detection/worker");
      await processFaceDetectionJob(job);
    },
    {
      connection,
      concurrency: 2,
      // Optional: Add a limiter to prevent overloading the system
      // limiter: { max: 10, duration: 60_000 },
    },
  );

  faceDetectionWorker.on("completed", (job) => {
    console.log(`[queue] Job ${job.id} (${job.name}) completed`);
  });

  faceDetectionWorker.on("failed", (job, err) => {
    console.error(`[queue] Job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  workers.push(faceDetectionWorker);
  console.log("[queue] Face detection worker started");

  nitro.hooks.hook("close", async () => {
    for (const worker of workers) {
      await worker.close();
    }
    await closeAllQueues();
    console.log("[queue] Workers and queues closed");
  });
});
