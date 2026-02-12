import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Server, EVENTS } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { getLibraryAccess } from "~~/server/domain/library/access";
import { normalizeFolderId, assertFolderInLibrary } from "~~/server/domain/library/folders";
import { isLibraryFaceRecognitionEnabled } from "~~/server/domain/library/faces";

/**
 * tus resumable upload endpoint.
 *
 * The client sends upload metadata via the tus protocol headers:
 *   - libraryId:    target library UUID (required)
 *   - filename:     original filename (required)
 *   - mimeType:     MIME type string (optional)
 *   - lastModified: epoch ms of the original file (optional)
 *   - folderId:     target folder UUID (optional)
 *
 * Auth is handled by the existing H3 middleware which runs before this handler.
 * Library admin access is validated in the onUploadCreate hook.
 */

const TUS_PATH = "/api/tus";

// Lazy-initialised singleton — resolved on first request so that
// runtime config (storage paths) is available.
let _tusServer: Server | null = null;

function getTusServer(): Server {
  if (_tusServer) return _tusServer;

  const config = useRuntimeConfig();
  const tusUploadDir = join(String(config.storagePath), ".tus-uploads");

  const tusServer = new Server({
    path: TUS_PATH,
    datastore: new FileStore({ directory: tusUploadDir }),
    respectForwardedHeaders: true,
    // No max size limit — we trust the proxy / infra to enforce limits
    // maxSize: undefined,

    /**
     * Validate metadata and authorise the upload before creation.
     * The userId is passed via the X-Upload-User-Id header, set by
     * the H3 handler below after middleware auth completes.
     */
    async onUploadCreate(req, upload) {
      const userId = req.headers.get("x-upload-user-id");
      if (!userId) {
        throw { status_code: 401, body: "Unauthorized" };
      }

      const libraryId = upload.metadata?.libraryId;
      const filename = upload.metadata?.filename;

      if (!libraryId) {
        throw { status_code: 400, body: "Missing libraryId in upload metadata" };
      }
      if (!filename) {
        throw { status_code: 400, body: "Missing filename in upload metadata" };
      }

      // Verify library admin access
      const access = await getLibraryAccess(userId, libraryId);
      if (!access || !access.isAdmin) {
        throw { status_code: 403, body: "Library admin access required" };
      }

      // Validate folder if provided
      const folderId = normalizeFolderId(upload.metadata?.folderId ?? null);
      if (folderId) {
        try {
          await assertFolderInLibrary(libraryId, folderId);
        } catch {
          throw { status_code: 400, body: "Invalid folder" };
        }
      }

      // Persist userId + generated fileId in metadata for POST_FINISH
      const fileId = randomUUID();
      return {
        metadata: {
          ...upload.metadata,
          userId,
          fileId,
        },
      };
    },
  });

  // After upload completes: move file to permanent storage and create DB record
  tusServer.on(EVENTS.POST_FINISH, async (_req, _res, upload) => {
    const meta = upload.metadata ?? {};
    const libraryId = meta.libraryId!;
    const fileId = meta.fileId!;
    const userId = meta.userId!;
    const filename = meta.filename!;
    const mimeType = meta.mimeType || "application/octet-stream";
    const lastModified = meta.lastModified || null;
    const parentFolderId = normalizeFolderId(meta.folderId ?? null);
    const fileSize = upload.size ?? upload.offset;

    const config = useRuntimeConfig();
    const tusUploadDir = join(String(config.storagePath), ".tus-uploads");
    const storagePath = String(config.storagePath);

    // Move the completed tus upload to permanent storage location.
    // The @tus/file-store stores files using the upload ID as filename.
    const tusFilePath = join(tusUploadDir, upload.id);
    const permanentDir = join(storagePath, libraryId, fileId);
    const permanentPath = join(permanentDir, "blob");

    try {
      await mkdir(permanentDir, { recursive: true });
      await rename(tusFilePath, permanentPath);
    } catch (error) {
      console.error(`[tus] Failed to move upload ${upload.id} to storage:`, error);
      return;
    }

    // Clean up the .json metadata file left by @tus/file-store
    const tusInfoPath = `${tusFilePath}.json`;
    rm(tusInfoPath, { force: true }).catch(() => {});

    try {
      const [file] = await db
        .insert(schema.files)
        .values({
          id: fileId,
          libraryId,
          ownerId: userId,
          parentFolderId,
          name: filename,
          mimeType,
          size: fileSize,
          originalCreatedAt: lastModified ? new Date(Number(lastModified)) : null,
        })
        .returning();

      // Enqueue face detection if applicable (non-blocking)
      if (file && file.mimeType.startsWith("image/")) {
        isLibraryFaceRecognitionEnabled(libraryId)
          .then((enabled) => {
            if (enabled && file) {
              enqueueJob("{face-detection}", "detect-faces", {
                fileId: file.id,
                libraryId,
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
            libraryId,
          }).catch(() => {});
        }
      }
    } catch (error) {
      // Clean up the stored file if DB insert fails
      console.error(`[tus] Failed to create DB record for upload ${upload.id}:`, error);
      rm(permanentDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  _tusServer = tusServer;
  return tusServer;
}

/**
 * Catch-all handler for /api/tus/*
 *
 * Auth middleware has already run and set event.context.userId.
 * We inject the userId into the web Request headers so the tus
 * onUploadCreate hook can read it.
 */
export const tusEventHandler = defineEventHandler(async (event) => {
  const userId = event.context.userId as string | undefined;
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const tusServer = getTusServer();

  // Convert H3 event to a web Request, injecting the authenticated userId
  const webRequest = toWebRequest(event);
  const headers = new Headers(webRequest.headers);
  headers.set("x-upload-user-id", userId);

  const tusRequest = new Request(webRequest.url, {
    method: webRequest.method,
    headers,
    body: webRequest.body,
    // Required for streaming request bodies in Node/Bun
    duplex: "half",
  } as RequestInit);

  const response = await tusServer.handleWeb(tusRequest);

  // Forward the tus Response directly back to the client.
  // sendWebResponse copies status, headers, and body.
  return sendWebResponse(event, response);
});
