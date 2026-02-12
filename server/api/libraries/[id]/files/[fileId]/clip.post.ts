import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { extractClip, probeVideo } from "~~/server/services/video/ffmpeg";
import * as z from "zod";

const clipSchema = z.object({
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  name: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;
  const userId = event.context.userId as string;
  const storage = useStorageService();

  const body = await readBody(event);
  const parsed = clipSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  const { startTime, endTime, name: clipName } = parsed.data;

  // Load source file
  const [source] = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.libraryId, libraryId)))
    .limit(1);

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }
  if (!source.mimeType.startsWith("video/")) {
    throw createError({ statusCode: 400, statusMessage: "File is not a video" });
  }

  const tmpInput = join(tmpdir(), `alcoves-clip-in-${randomUUID()}`);
  const tmpOutput = join(tmpdir(), `alcoves-clip-out-${randomUUID()}.mp4`);
  const newFileId = randomUUID();

  try {
    // Write source to temp
    const sourceBuffer = await storage.readFileBuffer(libraryId, fileId);
    await writeFile(tmpInput, sourceBuffer);

    // Extract clip
    await extractClip({
      inputPath: tmpInput,
      outputPath: tmpOutput,
      startTime,
      endTime,
    });

    // Read clip and store
    const clipBuffer = Buffer.from(await Bun.file(tmpOutput).bytes());
    await storage.storeFile(libraryId, newFileId, clipBuffer);

    // Probe clip for metadata
    let duration = 0;
    let width = 0;
    let height = 0;
    try {
      const probe = await probeVideo(tmpOutput);
      duration = probe.duration;
      width = probe.width;
      height = probe.height;
    } catch {
      // Non-fatal
    }

    // Determine name
    const baseName = clipName || `${source.name.replace(/\.[^.]+$/, "")}_clip`;
    const finalName = baseName.endsWith(".mp4") ? baseName : `${baseName}.mp4`;

    // Insert new file record
    const [clip] = await db
      .insert(schema.files)
      .values({
        id: newFileId,
        libraryId,
        ownerId: source.ownerId || userId,
        parentFolderId: source.parentFolderId,
        name: finalName,
        mimeType: "video/mp4",
        size: clipBuffer.byteLength,
        duration,
        width,
        height,
        proxyStatus: "not_needed",
        sourceFileId: source.id,
      })
      .returning();

    // Copy tags from source file
    const sourceTags = await db
      .select({ tagId: schema.fileTags.tagId })
      .from(schema.fileTags)
      .where(eq(schema.fileTags.fileId, fileId));

    if (sourceTags.length > 0) {
      await db.insert(schema.fileTags).values(
        sourceTags.map((t) => ({
          fileId: newFileId,
          tagId: t.tagId,
        })),
      );
    }

    // Enqueue video processing for thumbnail generation
    if (isQueueConfigured()) {
      await enqueueJob("{video-processing}", "process-video", {
        fileId: newFileId,
        libraryId,
      });
    }

    return clip;
  } finally {
    await unlink(tmpInput).catch(() => {});
    await unlink(tmpOutput).catch(() => {});
  }
});
