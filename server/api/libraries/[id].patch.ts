import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { requireLibraryAdmin } from "~~/server/domain/library/access";
import {
  enqueueExistingLibraryImages,
  deleteLibraryFaceData,
} from "~~/server/services/face-detection/bulk";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const body = await readBody<{ name?: string; faceRecognitionEnabled?: boolean }>(event);

  if (!body || (body.name === undefined && body.faceRecognitionEnabled === undefined)) {
    throw createError({ statusCode: 400, statusMessage: "No fields to update" });
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      throw createError({ statusCode: 400, statusMessage: "Name cannot be empty" });
    }
    updates.name = body.name.trim();
  }

  if (body.faceRecognitionEnabled !== undefined) {
    await requireLibraryAdmin(event, id);
    updates.faceRecognitionEnabled = body.faceRecognitionEnabled;
  }

  const [library] = await db
    .update(schema.libraries)
    .set(updates)
    .where(eq(schema.libraries.id, id))
    .returning();

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  // Handle face recognition toggle side effects (non-blocking)
  if (body.faceRecognitionEnabled === true) {
    enqueueExistingLibraryImages(id).catch((err) => {
      console.error("[face-detection] Failed to enqueue existing images:", err);
    });
  } else if (body.faceRecognitionEnabled === false) {
    deleteLibraryFaceData(id).catch((err) => {
      console.error("[face-detection] Failed to delete face data:", err);
    });
  }

  return library;
});
