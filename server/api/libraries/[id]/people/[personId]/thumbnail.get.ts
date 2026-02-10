import { eq, and } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const personId = getRouterParam(event, "personId")!;

  // Get the person's cover face detection
  const [person] = await db
    .select({ coverFaceDetectionId: schema.people.coverFaceDetectionId })
    .from(schema.people)
    .where(and(eq(schema.people.id, personId), eq(schema.people.libraryId, id)))
    .limit(1);

  if (!person?.coverFaceDetectionId) {
    throw createError({ statusCode: 404, statusMessage: "No thumbnail available" });
  }

  const storage = useStorageService();
  const cacheKey = `faces/${person.coverFaceDetectionId}.jpg`;

  if (!(await storage.cacheExists(cacheKey))) {
    throw createError({ statusCode: 404, statusMessage: "Thumbnail not found" });
  }

  setResponseHeader(event, "content-type", "image/jpeg");
  setResponseHeader(event, "cache-control", "public, max-age=86400");

  return storage.openCacheReadStream(cacheKey);
});
