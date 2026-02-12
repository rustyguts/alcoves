import { eq, desc } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  await requireUserId(event);

  const people = await db
    .select({
      id: schema.people.id,
      libraryId: schema.people.libraryId,
      name: schema.people.name,
      faceCount: schema.people.faceCount,
      coverFaceDetectionId: schema.people.coverFaceDetectionId,
      createdAt: schema.people.createdAt,
      updatedAt: schema.people.updatedAt,
    })
    .from(schema.people)
    .where(eq(schema.people.libraryId, id))
    .orderBy(desc(schema.people.faceCount));

  return people;
});
