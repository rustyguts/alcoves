import { eq, and, inArray, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  await requireUserId(event);

  const body = await readBody<{ personIds: string[]; targetName?: string }>(event);
  if (!body?.personIds || body.personIds.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: "At least 2 person IDs required for merge",
    });
  }

  const { personIds, targetName } = body;

  // Verify all people belong to this library
  const people = await db
    .select({ id: schema.people.id, faceCount: schema.people.faceCount, name: schema.people.name })
    .from(schema.people)
    .where(and(eq(schema.people.libraryId, id), inArray(schema.people.id, personIds)));

  if (people.length !== personIds.length) {
    throw createError({ statusCode: 400, statusMessage: "Some people not found in this library" });
  }

  const sortedByFaceCount = [...people].sort((a, b) => b.faceCount - a.faceCount);
  const primaryPerson = sortedByFaceCount[0]!;
  const targetId = primaryPerson.id;
  const sourceIds = people.filter((person) => person.id !== targetId).map((person) => person.id);
  const mergedName = targetName !== undefined ? targetName : (primaryPerson.name ?? null);

  await db.transaction(async (tx) => {
    // Move all face detections from sources to target
    await tx
      .update(schema.faceDetections)
      .set({ personId: targetId })
      .where(inArray(schema.faceDetections.personId, sourceIds));

    // Delete source people
    await tx.delete(schema.people).where(inArray(schema.people.id, sourceIds));

    // Recalculate face count for target
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.faceDetections)
      .where(eq(schema.faceDetections.personId, targetId));

    const [targetPerson] = await tx
      .select({ coverFaceDetectionId: schema.people.coverFaceDetectionId })
      .from(schema.people)
      .where(eq(schema.people.id, targetId))
      .limit(1);

    let coverFaceDetectionId = targetPerson?.coverFaceDetectionId ?? null;

    if (coverFaceDetectionId) {
      const [coverExists] = await tx
        .select({ id: schema.faceDetections.id })
        .from(schema.faceDetections)
        .where(
          and(
            eq(schema.faceDetections.id, coverFaceDetectionId),
            eq(schema.faceDetections.personId, targetId),
          ),
        )
        .limit(1);
      if (!coverExists) coverFaceDetectionId = null;
    }

    if (!coverFaceDetectionId) {
      const [firstFace] = await tx
        .select({ id: schema.faceDetections.id })
        .from(schema.faceDetections)
        .where(eq(schema.faceDetections.personId, targetId))
        .limit(1);
      coverFaceDetectionId = firstFace?.id ?? null;
    }

    const updates: Record<string, unknown> = {
      faceCount: count?.total ?? 0,
      coverFaceDetectionId,
    };
    if (mergedName !== undefined) {
      updates.name = mergedName?.trim() || null;
    }

    await tx.update(schema.people).set(updates).where(eq(schema.people.id, targetId));
  });

  // Return updated target person
  const [merged] = await db
    .select()
    .from(schema.people)
    .where(eq(schema.people.id, targetId))
    .limit(1);

  return merged;
});
