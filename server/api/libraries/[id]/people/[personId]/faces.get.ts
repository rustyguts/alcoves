import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const personId = getRouterParam(event, "personId")!;
  await requireUserId(event);

  const faces = await db
    .select({
      id: schema.faceDetections.id,
      fileId: schema.faceDetections.fileId,
      fileName: schema.files.name,
      boxX: schema.faceDetections.boxX,
      boxY: schema.faceDetections.boxY,
      boxWidth: schema.faceDetections.boxWidth,
      boxHeight: schema.faceDetections.boxHeight,
      imageWidth: schema.faceDetections.imageWidth,
      imageHeight: schema.faceDetections.imageHeight,
      confidence: schema.faceDetections.confidence,
      createdAt: schema.faceDetections.createdAt,
    })
    .from(schema.faceDetections)
    .innerJoin(schema.files, eq(schema.faceDetections.fileId, schema.files.id))
    .where(
      and(eq(schema.faceDetections.personId, personId), eq(schema.faceDetections.libraryId, id)),
    )
    .orderBy(desc(schema.faceDetections.createdAt));

  return faces;
});
