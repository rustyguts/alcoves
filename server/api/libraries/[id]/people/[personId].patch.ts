import { eq, and } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const personId = getRouterParam(event, "personId")!;
  await requireUserId(event);

  const body = await readBody<{ name?: string; coverFaceDetectionId?: string | null }>(event);
  if (!body || (body.name === undefined && body.coverFaceDetectionId === undefined)) {
    throw createError({
      statusCode: 400,
      statusMessage: "At least one update field is required",
    });
  }

  const updates: Partial<typeof schema.people.$inferInsert> = {};

  if (body.name !== undefined) {
    updates.name = body.name.trim() || null;
  }

  if (body.coverFaceDetectionId !== undefined) {
    if (body.coverFaceDetectionId !== null) {
      const [face] = await db
        .select({ id: schema.faceDetections.id })
        .from(schema.faceDetections)
        .where(
          and(
            eq(schema.faceDetections.id, body.coverFaceDetectionId),
            eq(schema.faceDetections.libraryId, id),
            eq(schema.faceDetections.personId, personId),
          ),
        )
        .limit(1);

      if (!face) {
        throw createError({
          statusCode: 400,
          statusMessage: "Selected cover face does not belong to this person",
        });
      }
    }

    updates.coverFaceDetectionId = body.coverFaceDetectionId;
  }

  const [person] = await db
    .update(schema.people)
    .set(updates)
    .where(and(eq(schema.people.id, personId), eq(schema.people.libraryId, id)))
    .returning();

  if (!person) {
    throw createError({ statusCode: 404, statusMessage: "Person not found" });
  }

  return person;
});
