import { Worker } from "bullmq";
import type { Job } from "bullmq";

const workers: Worker[] = [];

export default defineNitroPlugin(async (nitro) => {
  if (!isWorkerMode()) {
    console.log(`[queue] Server mode is "${getServerMode()}", skipping worker startup`);
    return;
  }

  if (!isQueueConfigured()) {
    console.log("[queue] No queue host configured, skipping worker startup");
    return;
  }

  console.log(`[queue] Starting workers (mode: ${getServerMode()})`);

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

  const videoProcessingWorker = new Worker(
    "{video-processing}",
    async (job: Job) => {
      const { processVideoJob } = await import("~~/server/services/video/worker");
      await processVideoJob(job);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  videoProcessingWorker.on("completed", (job) => {
    console.log(`[queue] Video job ${job.id} (${job.name}) completed`);
  });

  videoProcessingWorker.on("failed", (job, err) => {
    console.error(`[queue] Video job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  workers.push(videoProcessingWorker);
  console.log("[queue] Video processing worker started");

  nitro.hooks.hook("close", async () => {
    for (const worker of workers) {
      await worker.close();
    }
    await closeAllQueues();
    console.log("[queue] Workers and queues closed");
  });
});
