import { and, eq } from "drizzle-orm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db, schema } from "~~/server/database";
import { generateThumbnail } from "~~/server/services/video/ffmpeg";
import { videoThumbnailKey } from "~~/server/services/video/worker";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;
  const storage = useStorageService();

  const [file] = await db
    .select({ id: schema.files.id, mimeType: schema.files.mimeType })
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.libraryId, libraryId)))
    .limit(1);

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }
  if (!file.mimeType.startsWith("video/")) {
    throw createError({ statusCode: 400, statusMessage: "File is not a video" });
  }

  const cacheKey = videoThumbnailKey(libraryId, fileId);

  // Serve from cache if available
  if (await storage.cacheExists(cacheKey)) {
    setHeaders(event, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    return sendStream(event, await storage.openCacheReadStream(cacheKey));
  }

  // Auto-regenerate: read video from storage, extract thumbnail
  const sourceExists = await storage.fileExists(libraryId, fileId);
  if (!sourceExists) {
    throw createError({ statusCode: 404, statusMessage: "Video file not found on disk" });
  }

  const tmpPath = join(tmpdir(), `alcoves-thumb-${randomUUID()}`);
  try {
    const sourceBuffer = await storage.readFileBuffer(libraryId, fileId);
    await writeFile(tmpPath, sourceBuffer);

    const thumbnailBuffer = await generateThumbnail(tmpPath, {
      timestamp: 1,
      width: 640,
    });

    // Store for next time
    await storage.storeCacheBuffer(cacheKey, thumbnailBuffer);

    setHeaders(event, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    return thumbnailBuffer;
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Failed to generate thumbnail" });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
});
