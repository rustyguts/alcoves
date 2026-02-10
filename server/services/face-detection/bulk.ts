import { eq, and, isNull, like } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export async function enqueueExistingLibraryImages(libraryId: string): Promise<number> {
  const imageFiles = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.libraryId, libraryId),
        isNull(schema.files.trashedAt),
        like(schema.files.mimeType, "image/%"),
      ),
    );

  for (const file of imageFiles) {
    await enqueueJob("{face-detection}", "detect-faces", {
      fileId: file.id,
      libraryId,
    });
  }

  return imageFiles.length;
}

export async function deleteLibraryFaceData(libraryId: string): Promise<void> {
  // Get all face detection IDs for cache cleanup
  const detections = await db
    .select({ id: schema.faceDetections.id })
    .from(schema.faceDetections)
    .where(eq(schema.faceDetections.libraryId, libraryId));

  // Delete face detections and people in a transaction
  await db.transaction(async (tx) => {
    await tx.delete(schema.faceDetections).where(eq(schema.faceDetections.libraryId, libraryId));
    await tx.delete(schema.people).where(eq(schema.people.libraryId, libraryId));
  });

  // Clean up cached face thumbnails
  if (detections.length > 0) {
    const storage = useStorageService();
    for (const detection of detections) {
      try {
        await storage.deleteCachePrefix(`faces/${detection.id}.jpg`);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
