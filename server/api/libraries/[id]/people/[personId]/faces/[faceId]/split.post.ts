import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const personId = getRouterParam(event, "personId")!;
  const faceId = getRouterParam(event, "faceId")!;
  await requireUserId(event);

  const body = await readBody<{ name?: string }>(event);
  const nextName = body?.name?.trim() || null;

  const [face] = await db
    .select({ id: schema.faceDetections.id })
    .from(schema.faceDetections)
    .where(
      and(
        eq(schema.faceDetections.id, faceId),
        eq(schema.faceDetections.libraryId, id),
        eq(schema.faceDetections.personId, personId),
      ),
    )
    .limit(1);

  if (!face) {
    throw createError({
      statusCode: 404,
      statusMessage: "Face match not found for this person",
    });
  }

  const result = await db.transaction(async (tx) => {
    const [sourcePerson] = await tx
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(and(eq(schema.people.id, personId), eq(schema.people.libraryId, id)))
      .limit(1);

    if (!sourcePerson) {
      throw createError({ statusCode: 404, statusMessage: "Person not found" });
    }

    const [createdPerson] = await tx
      .insert(schema.people)
      .values({
        libraryId: id,
        name: nextName,
        coverFaceDetectionId: faceId,
        faceCount: 1,
      })
      .returning();

    await tx
      .update(schema.faceDetections)
      .set({ personId: createdPerson!.id })
      .where(eq(schema.faceDetections.id, faceId));

    const [remainingCount] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.faceDetections)
      .where(eq(schema.faceDetections.personId, personId));

    if ((remainingCount?.total ?? 0) <= 0) {
      await tx.delete(schema.people).where(eq(schema.people.id, personId));
    } else {
      const [sourcePersonRow] = await tx
        .select({ coverFaceDetectionId: schema.people.coverFaceDetectionId })
        .from(schema.people)
        .where(eq(schema.people.id, personId))
        .limit(1);

      let coverFaceDetectionId = sourcePersonRow?.coverFaceDetectionId ?? null;
      if (coverFaceDetectionId) {
        const [coverExists] = await tx
          .select({ id: schema.faceDetections.id })
          .from(schema.faceDetections)
          .where(
            and(
              eq(schema.faceDetections.id, coverFaceDetectionId),
              eq(schema.faceDetections.personId, personId),
            ),
          )
          .limit(1);

        if (!coverExists) coverFaceDetectionId = null;
      }

      if (!coverFaceDetectionId) {
        const [latestFace] = await tx
          .select({ id: schema.faceDetections.id })
          .from(schema.faceDetections)
          .where(eq(schema.faceDetections.personId, personId))
          .orderBy(desc(schema.faceDetections.createdAt))
          .limit(1);
        coverFaceDetectionId = latestFace?.id ?? null;
      }

      await tx
        .update(schema.people)
        .set({
          faceCount: remainingCount?.total ?? 0,
          coverFaceDetectionId,
        })
        .where(eq(schema.people.id, personId));
    }

    return createdPerson!;
  });

  return result;
});
