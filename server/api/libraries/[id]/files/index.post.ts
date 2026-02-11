import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, normalizeFolderId } from "~~/server/domain/library/folders";
import { isLibraryFaceRecognitionEnabled } from "~~/server/domain/library/faces";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const userId = event.context.userId as string;
  const storage = useStorageService();

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, id))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const fileId = randomUUID();
  const rawBody = await readRawBody(event, false);
  if (!rawBody) {
    throw createError({ statusCode: 400, statusMessage: "No upload data provided" });
  }

  const contentType = getHeader(event, "content-type") || "";
  const decodeHeaderValue = (value: string | undefined): string | null => {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const size = rawBody.length;
  try {
    await storage.storeFile(id, fileId, rawBody);
  } catch (error: unknown) {
    await storage.deleteFile(id, fileId).catch(() => {});
    if (isAbortError(error)) {
      throw createError({ statusCode: 408, statusMessage: "Upload interrupted" });
    }
    throw error;
  }

  const name = decodeHeaderValue(getHeader(event, "x-file-name")) || "unnamed";
  const mimeType =
    getHeader(event, "x-file-mime-type") || contentType || "application/octet-stream";
  const originalCreatedAt = getHeader(event, "x-file-original-created-at") || null;
  const parentFolderId = normalizeFolderId(
    decodeHeaderValue(getHeader(event, "x-file-parent-folder-id")),
  );

  if (parentFolderId) {
    await assertFolderInLibrary(id, parentFolderId);
  }

  try {
    const [file] = await db
      .insert(schema.files)
      .values({
        id: fileId,
        libraryId: id,
        ownerId: userId,
        parentFolderId,
        name: name.trim(),
        mimeType,
        size,
        originalCreatedAt: originalCreatedAt ? new Date(Number(originalCreatedAt)) : null,
      })
      .returning();

    // Enqueue face detection if applicable (non-blocking)
    if (file && file.mimeType.startsWith("image/")) {
      isLibraryFaceRecognitionEnabled(id)
        .then((enabled) => {
          if (enabled && file) {
            enqueueJob("{face-detection}", "detect-faces", {
              fileId: file.id,
              libraryId: id,
            });
          }
        })
        .catch(() => {});
    }

    return file;
  } catch {
    await storage.deleteFile(id, fileId);
    throw createError({ statusCode: 500, statusMessage: "Failed to save file record" });
  }
});

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "AbortError" || message.toLowerCase().includes("aborted");
}
