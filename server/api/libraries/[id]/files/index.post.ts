import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getRequestWebStream } from "h3";
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

  const upload = await parseUpload(event, id, storage);
  const parentFolderId = normalizeFolderId(upload.parentFolderId);

  if (parentFolderId) {
    await assertFolderInLibrary(id, parentFolderId);
  }

  try {
    const [file] = await db
      .insert(schema.files)
      .values({
        id: upload.fileId,
        libraryId: id,
        ownerId: userId,
        parentFolderId,
        name: upload.name.trim(),
        mimeType: upload.mimeType,
        size: upload.size,
        originalCreatedAt: upload.originalCreatedAt
          ? new Date(Number(upload.originalCreatedAt))
          : null,
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
    await storage.deleteFile(id, upload.fileId);
    throw createError({ statusCode: 500, statusMessage: "Failed to save file record" });
  }
});

async function parseUpload(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  libraryId: string,
  storage: ReturnType<typeof useStorageService>,
) {
  const contentType = getHeader(event, "content-type") || "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    return await parseMultipartUpload(event, libraryId, storage);
  }

  return await parseRawUpload(event, libraryId, storage, contentType);
}

async function parseRawUpload(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  libraryId: string,
  storage: ReturnType<typeof useStorageService>,
  contentType: string,
) {
  const fileId = randomUUID();
  const requestStream = getRequestWebStream(event);
  if (!requestStream) {
    throw createError({ statusCode: 400, statusMessage: "No upload data provided" });
  }

  const decodeHeaderValue = (value: string | undefined): string | null => {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  try {
    const size = await storage.storeFileStream(libraryId, fileId, requestStream);
    return {
      fileId,
      name: decodeHeaderValue(getHeader(event, "x-file-name")) || "unnamed",
      mimeType:
        getHeader(event, "x-file-mime-type") || contentType || "application/octet-stream",
      size,
      originalCreatedAt: getHeader(event, "x-file-original-created-at") || null,
      parentFolderId: decodeHeaderValue(getHeader(event, "x-file-parent-folder-id")),
    };
  } catch (error: unknown) {
    await storage.deleteFile(libraryId, fileId).catch(() => {});

    const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
    const message =
      typeof error === "object" && error && "message" in error ? String(error.message) : "";
    if (name === "AbortError" || message.toLowerCase().includes("aborted")) {
      throw createError({ statusCode: 408, statusMessage: "Upload interrupted" });
    }

    throw error;
  }
}

async function parseMultipartUpload(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  libraryId: string,
  storage: ReturnType<typeof useStorageService>,
) {
  const parts = await readMultipartFormData(event).catch((error: unknown) => {
    const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
    const message =
      typeof error === "object" && error && "message" in error ? String(error.message) : "";

    if (name === "AbortError" || message.toLowerCase().includes("aborted")) {
      throw createError({ statusCode: 408, statusMessage: "Upload interrupted" });
    }

    throw createError({
      statusCode: 400,
      statusMessage: "Invalid multipart upload data",
    });
  });

  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: "No upload data provided" });
  }

  const filePart = parts.find((part) => part.name === "file" && part.filename && part.data);
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: "No file uploaded" });
  }

  const fileId = randomUUID();
  try {
    const fileBuffer = Buffer.from(filePart.data);
    await storage.storeFile(libraryId, fileId, fileBuffer);
    const size = fileBuffer.byteLength;

    const getField = (name: string): string | null => {
      const value = parts.find((part) => part.name === name && !part.filename && part.data);
      if (!value) return null;
      return Buffer.from(value.data).toString("utf8");
    };

    return {
      fileId,
      name: getField("name") || filePart.filename || "unnamed",
      mimeType: getField("mimeType") || filePart.type || "application/octet-stream",
      size,
      originalCreatedAt: getField("originalCreatedAt"),
      parentFolderId: getField("parentFolderId"),
    };
  } catch (error) {
    await storage.deleteFile(libraryId, fileId).catch(() => {});
    throw error;
  }
}
