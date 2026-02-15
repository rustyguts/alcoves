import type { Job } from "bullmq";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { detectFaces } from "./detect";
import { computeEmbedding } from "./recognize";
import { assignFaceUsingCorePoint, reconcileNewPerson } from "./clustering";
import { computeFaceQuality } from "./quality";

/** Quality threshold below which we skip embedding computation entirely */
const VERY_LOW_QUALITY = 0.15;

export async function processFaceDetectionJob(job: Job): Promise<void> {
  const { fileId, libraryId } = job.data as { fileId: string; libraryId: string };

  // Validate file exists, is an image, and not trashed
  const [file] = await db
    .select({
      id: schema.files.id,
      mimeType: schema.files.mimeType,
      trashedAt: schema.files.trashedAt,
    })
    .from(schema.files)
    .where(eq(schema.files.id, fileId))
    .limit(1);

  if (!file) throw new Error(`File ${fileId} not found`);
  if (!file.mimeType.startsWith("image/")) return;
  if (file.trashedAt) return;

  // Check idempotency - skip if faces already detected for this file
  const [existing] = await db
    .select({ id: schema.faceDetections.id })
    .from(schema.faceDetections)
    .where(eq(schema.faceDetections.fileId, fileId))
    .limit(1);

  if (existing) return;

  // Read image buffer from storage
  const storage = useStorageService();
  const imageBuffer = await storage.readFileBuffer(libraryId, fileId);

  await job.updateProgress(10);

  // Run face detection (SCRFD)
  const { faces, imageWidth, imageHeight } = await detectFaces(imageBuffer);

  await job.updateProgress(40);

  if (faces.length === 0) return;

  const progressPerFace = 50 / faces.length;

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i]!;

    // Compute face quality score
    const quality = computeFaceQuality(face, imageWidth, imageHeight);
    const qualityScoreInt = Math.round(quality * 1000);

    // Skip embedding computation for very low quality faces
    if (quality < VERY_LOW_QUALITY) {
      await db.insert(schema.faceDetections).values({
        fileId,
        libraryId,
        boxX: face.box.x,
        boxY: face.box.y,
        boxWidth: face.box.width,
        boxHeight: face.box.height,
        imageWidth,
        imageHeight,
        confidence: Math.round(face.confidence * 1000),
        qualityScore: qualityScoreInt,
        embedding: null,
      });

      await job.updateProgress(40 + Math.round((i + 1) * progressPerFace));
      continue;
    }

    // Compute face embedding (ArcFace)
    const embedding = await computeEmbedding(imageBuffer, face);
    const embeddingArray = Array.from(embedding);

    // Store face detection in DB
    const [detection] = await db
      .insert(schema.faceDetections)
      .values({
        fileId,
        libraryId,
        boxX: face.box.x,
        boxY: face.box.y,
        boxWidth: face.box.width,
        boxHeight: face.box.height,
        imageWidth,
        imageHeight,
        confidence: Math.round(face.confidence * 1000),
        qualityScore: qualityScoreInt,
        embedding: embeddingArray,
      })
      .returning({ id: schema.faceDetections.id });

    const detectionId = detection!.id;

    const assignment = await assignFaceUsingCorePoint(libraryId, detectionId, embeddingArray);

    if (assignment?.created) {
      await reconcileNewPerson(libraryId, assignment.personId);
    }

    // Generate face thumbnail: crop face region with padding, resize 150x150
    try {
      const padding = 0.3;
      const padX = Math.round(face.box.width * padding);
      const padY = Math.round(face.box.height * padding);
      const cropX = Math.max(0, face.box.x - padX);
      const cropY = Math.max(0, face.box.y - padY);
      const cropW = Math.min(imageWidth - cropX, face.box.width + padX * 2);
      const cropH = Math.min(imageHeight - cropY, face.box.height + padY * 2);

      const thumbnail = await sharp(imageBuffer)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .resize(150, 150, { fit: "cover" })
        .jpeg({ quality: 80 })
        .toBuffer();

      await storage.storeCacheBuffer(`faces/${detectionId}.jpg`, thumbnail);
    } catch (err) {
      console.warn(`[face-detection] Failed to generate thumbnail for ${detectionId}:`, err);
    }

    await job.updateProgress(40 + Math.round((i + 1) * progressPerFace));
  }

  await job.updateProgress(100);
}
