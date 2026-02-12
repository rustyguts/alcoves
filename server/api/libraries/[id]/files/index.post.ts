import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, normalizeFolderId } from "~~/server/domain/library/folders";
import { isLibraryFaceRecognitionEnabled } from "~~/server/domain/library/faces";

/**
 * Streaming file upload endpoint.
 *
 * The client sends the file as a raw binary body (application/octet-stream)
 * and passes metadata via HTTP headers:
 *
 *   X-Upload-Name:           original filename (required)
 *   X-Upload-Mime-Type:      MIME type string (optional, defaults to application/octet-stream)
 *   X-Upload-Last-Modified:  epoch ms of the original file (optional)
 *   X-Upload-Folder-Id:      target folder UUID (optional)
 *
 * The body is streamed directly to storage — the full file is never buffered
 * in server memory, so uploads of any size (50 GB+) work without exhausting
 * the heap.
 */
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

  // Read metadata from headers
  const name = (getHeader(event, "x-upload-name") || "").trim();
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: "Missing X-Upload-Name header" });
  }

  const mimeType = getHeader(event, "x-upload-mime-type") || "application/octet-stream";
  const lastModified = getHeader(event, "x-upload-last-modified") || null;
  const parentFolderId = normalizeFolderId(getHeader(event, "x-upload-folder-id") || null);

  if (parentFolderId) {
    await assertFolderInLibrary(id, parentFolderId);
  }

  // Stream the request body directly to storage
  const fileId = randomUUID();
  const fileSize = await streamBodyToStorage(event, storage, id, fileId);

  if (fileSize === 0) {
    await storage.deleteFile(id, fileId).catch(() => {});
    throw createError({ statusCode: 400, statusMessage: "No file data provided" });
  }

  try {
    const [file] = await db
      .insert(schema.files)
      .values({
        id: fileId,
        libraryId: id,
        ownerId: userId,
        parentFolderId,
        name,
        mimeType,
        size: fileSize,
        originalCreatedAt: lastModified ? new Date(Number(lastModified)) : null,
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

    // Enqueue video processing (thumbnail + proxy) for videos
    if (file && file.mimeType.startsWith("video/")) {
      db.update(schema.files)
        .set({ proxyStatus: "pending" })
        .where(eq(schema.files.id, file.id))
        .catch(() => {});

      if (isQueueConfigured()) {
        enqueueJob("{video-processing}", "process-video", {
          fileId: file.id,
          libraryId: id,
        }).catch(() => {});
      }
    }

    return file;
  } catch {
    await storage.deleteFile(id, fileId);
    throw createError({ statusCode: 500, statusMessage: "Failed to save file record" });
  }
});

// ---------------------------------------------------------------------------
// Stream the raw request body to storage
// ---------------------------------------------------------------------------

/**
 * Reads the request body as a ReadableStream and pipes it directly to the
 * storage driver. Returns the number of bytes written.
 *
 * Falls back to reading the raw body as a Buffer for environments that don't
 * expose the web Request body stream.
 */
async function streamBodyToStorage(
  event: Parameters<typeof readRawBody>[0],
  storage: ReturnType<typeof useStorageService>,
  libraryId: string,
  fileId: string,
): Promise<number> {
  // Primary path: streaming via web Request body
  const webRequest = toWebRequest(event);
  if (webRequest.body) {
    try {
      return await storage.storeFileStream(libraryId, fileId, webRequest.body);
    } catch (error: unknown) {
      await storage.deleteFile(libraryId, fileId).catch(() => {});
      if (isAbortError(error)) {
        throw createError({ statusCode: 408, statusMessage: "Upload interrupted" });
      }
      throw error;
    }
  }

  // Fallback: buffer-based for environments without streaming
  const body = await readRawBody(event, false);
  if (!body || body.byteLength === 0) {
    return 0;
  }

  await storage.storeFile(libraryId, fileId, Buffer.from(body));
  return body.byteLength;
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "AbortError" || message.toLowerCase().includes("aborted");
}
