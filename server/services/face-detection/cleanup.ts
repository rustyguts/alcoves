import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export async function deleteFaceDataForFiles(libraryId: string, fileIds: string[]): Promise<void> {
  const uniqueFileIds = Array.from(new Set(fileIds));
  if (uniqueFileIds.length === 0) return;

  const detections = await db
    .select({
      id: schema.faceDetections.id,
      personId: schema.faceDetections.personId,
    })
    .from(schema.faceDetections)
    .where(
      and(
        eq(schema.faceDetections.libraryId, libraryId),
        inArray(schema.faceDetections.fileId, uniqueFileIds),
      ),
    );

  if (detections.length === 0) return;

  const personIds = Array.from(
    new Set(
      detections.map((detection) => detection.personId).filter((id): id is string => Boolean(id)),
    ),
  );

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.faceDetections)
      .where(
        and(
          eq(schema.faceDetections.libraryId, libraryId),
          inArray(schema.faceDetections.fileId, uniqueFileIds),
        ),
      );

    for (const personId of personIds) {
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.faceDetections)
        .where(
          and(eq(schema.faceDetections.libraryId, libraryId), eq(schema.faceDetections.personId, personId)),
        );

      const nextCount = count?.total ?? 0;
      if (nextCount <= 0) {
        await tx
          .delete(schema.people)
          .where(and(eq(schema.people.libraryId, libraryId), eq(schema.people.id, personId)));
        continue;
      }

      const [person] = await tx
        .select({ coverFaceDetectionId: schema.people.coverFaceDetectionId })
        .from(schema.people)
        .where(and(eq(schema.people.libraryId, libraryId), eq(schema.people.id, personId)))
        .limit(1);

      if (!person) continue;

      let coverFaceDetectionId = person.coverFaceDetectionId;
      if (coverFaceDetectionId) {
        const [coverExists] = await tx
          .select({ id: schema.faceDetections.id })
          .from(schema.faceDetections)
          .where(
            and(
              eq(schema.faceDetections.libraryId, libraryId),
              eq(schema.faceDetections.personId, personId),
              eq(schema.faceDetections.id, coverFaceDetectionId),
            ),
          )
          .limit(1);

        if (!coverExists) coverFaceDetectionId = null;
      }

      if (!coverFaceDetectionId) {
        const [latestFace] = await tx
          .select({ id: schema.faceDetections.id })
          .from(schema.faceDetections)
          .where(
            and(eq(schema.faceDetections.libraryId, libraryId), eq(schema.faceDetections.personId, personId)),
          )
          .orderBy(desc(schema.faceDetections.createdAt))
          .limit(1);
        coverFaceDetectionId = latestFace?.id ?? null;
      }

      await tx
        .update(schema.people)
        .set({ faceCount: nextCount, coverFaceDetectionId })
        .where(and(eq(schema.people.libraryId, libraryId), eq(schema.people.id, personId)));
    }
  });

  const storage = useStorageService();
  for (const detection of detections) {
    try {
      await storage.deleteCachePrefix(`faces/${detection.id}.jpg`);
    } catch {
      // Ignore cache cleanup failures.
    }
  }
}
