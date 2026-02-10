import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { requireLibraryAdmin } from "~~/server/domain/library/access";
import { reprocessLibraryFaceData } from "~~/server/services/face-detection/bulk";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  await requireLibraryAdmin(event, id);

  const [library] = await db
    .select({ faceRecognitionEnabled: schema.libraries.faceRecognitionEnabled })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, id))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  if (!library.faceRecognitionEnabled) {
    throw createError({
      statusCode: 400,
      statusMessage: "Enable facial recognition before reprocessing",
    });
  }

  const queuedCount = await reprocessLibraryFaceData(id);
  return { queuedCount };
});
