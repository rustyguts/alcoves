import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db, schema } from "~~/server/database";
import { probeVideo, isBrowserPlayable, generateThumbnail, transcodeToProxy } from "./ffmpeg";

/**
 * Video processing worker — runs as a BullMQ job.
 *
 * 1. Probe the uploaded video with ffprobe
 * 2. Store metadata (duration, dimensions) in the DB
 * 3. Generate a JPEG thumbnail at ~1s
 * 4. If the video is NOT browser-playable, transcode to H.264/AAC 1080p MP4
 * 5. Store the proxy in the cache scope for streaming
 */
export async function processVideoJob(job: Job): Promise<void> {
  const { fileId, libraryId } = job.data as { fileId: string; libraryId: string };

  // Validate file exists and is a video
  const [file] = await db
    .select({
      id: schema.files.id,
      mimeType: schema.files.mimeType,
      trashedAt: schema.files.trashedAt,
      proxyStatus: schema.files.proxyStatus,
    })
    .from(schema.files)
    .where(eq(schema.files.id, fileId))
    .limit(1);

  if (!file) throw new Error(`File ${fileId} not found`);
  if (!file.mimeType.startsWith("video/")) return;
  if (file.trashedAt) return;
  // Skip if already processed
  if (file.proxyStatus && file.proxyStatus !== "pending") return;

  const storage = useStorageService();

  // Write file to a temp path for ffmpeg to read
  const tmpDir = tmpdir();
  const tmpInput = join(tmpDir, `alcoves-input-${randomUUID()}`);
  const tmpProxy = join(tmpDir, `alcoves-proxy-${randomUUID()}.mp4`);

  try {
    // Mark as processing
    await db
      .update(schema.files)
      .set({ proxyStatus: "processing" })
      .where(eq(schema.files.id, fileId));

    await job.updateProgress(5);

    // Read the source file from storage to a temp file
    const sourceBuffer = await storage.readFileBuffer(libraryId, fileId);
    await writeFile(tmpInput, sourceBuffer);

    await job.updateProgress(10);

    // Probe the video
    const probe = await probeVideo(tmpInput);

    // Store video metadata
    await db
      .update(schema.files)
      .set({
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
      })
      .where(eq(schema.files.id, fileId));

    await job.updateProgress(20);

    // Generate thumbnail at 1 second (or 0 if video is very short)
    const thumbTimestamp = Math.min(1, Math.max(0, probe.duration - 0.5));
    try {
      const thumbnailBuffer = await generateThumbnail(tmpInput, {
        timestamp: thumbTimestamp,
        width: 640,
      });
      await storage.storeCacheBuffer(videoThumbnailKey(libraryId, fileId), thumbnailBuffer);
    } catch (err) {
      console.warn(`[video] Failed to generate thumbnail for ${fileId}:`, err);
    }

    await job.updateProgress(30);

    // Check if proxy is needed
    if (isBrowserPlayable(probe)) {
      await db
        .update(schema.files)
        .set({ proxyStatus: "not_needed" })
        .where(eq(schema.files.id, fileId));

      await job.updateProgress(100);
      return;
    }

    // Transcode to H.264/AAC 1080p proxy
    await transcodeToProxy({
      inputPath: tmpInput,
      outputPath: tmpProxy,
      maxHeight: 1080,
      crf: 23,
      preset: "fast",
      onProgress: (pct) => {
        // Map 30-95% of overall progress to transcode progress
        const overall = 30 + Math.round(pct * 0.65);
        job.updateProgress(overall).catch(() => {});
      },
    });

    // Store the proxy in cache scope
    const proxyBuffer = await Bun.file(tmpProxy).bytes();
    await storage.storeCacheBuffer(
      videoProxyKey(libraryId, fileId),
      Buffer.from(proxyBuffer),
    );

    await db
      .update(schema.files)
      .set({ proxyStatus: "ready" })
      .where(eq(schema.files.id, fileId));

    await job.updateProgress(100);
  } catch (error: unknown) {
    console.error(`[video] Processing failed for ${fileId}:`, error);
    await db
      .update(schema.files)
      .set({ proxyStatus: "failed" })
      .where(eq(schema.files.id, fileId));
    throw error;
  } finally {
    // Clean up temp files
    await unlink(tmpInput).catch(() => {});
    await unlink(tmpProxy).catch(() => {});
  }
}

// Cache key helpers — exported for use by the streaming endpoints
export function videoThumbnailKey(libraryId: string, fileId: string): string {
  return `video/${libraryId}/${fileId}/thumbnail.jpg`;
}

export function videoProxyKey(libraryId: string, fileId: string): string {
  return `video/${libraryId}/${fileId}/proxy.mp4`;
}
