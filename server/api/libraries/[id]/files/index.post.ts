import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import Busboy from "busboy";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, normalizeFolderId } from "~~/server/utils/folders";

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

    return file;
  } catch {
    await storage.deleteFile(id, upload.fileId);
    throw createError({ statusCode: 500, statusMessage: "Failed to save file record" });
  }
});

function parseUpload(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  libraryId: string,
  storage: ReturnType<typeof useStorageService>,
) {
  return new Promise<{
    fileId: string;
    name: string;
    mimeType: string;
    size: number;
    originalCreatedAt: string | null;
    parentFolderId: string | null;
  }>((resolve, reject) => {
    const fields: Record<string, string> = {};
    let fileId = "";
    let filename = "";
    let busboyMimeType = "";
    let storePromise: Promise<number> | null = null;

    const busboy = Busboy({
      headers: event.node.req.headers,
      limits: { files: 1 },
    });

    busboy.on("field", (name: string, value: string) => {
      fields[name] = value;
    });

    busboy.on("file", (fieldname: string, stream: NodeJS.ReadableStream, info: Busboy.FileInfo) => {
      if (fieldname !== "file") {
        stream.resume();
        return;
      }
      fileId = randomUUID();
      filename = info.filename;
      busboyMimeType = info.mimeType;
      storePromise = storage.storeFileStream(
        libraryId,
        fileId,
        stream as import("node:stream").Readable,
      );
    });

    busboy.on("finish", async () => {
      if (!storePromise) {
        reject(createError({ statusCode: 400, statusMessage: "No file uploaded" }));
        return;
      }
      try {
        const size = await storePromise;
        resolve({
          fileId,
          name: fields.name || filename || "unnamed",
          mimeType: fields.mimeType || busboyMimeType || "application/octet-stream",
          size,
          originalCreatedAt: fields.originalCreatedAt || null,
          parentFolderId: fields.parentFolderId || null,
        });
      } catch (err) {
        await storage.deleteFile(libraryId, fileId).catch(() => {});
        reject(err);
      }
    });

    busboy.on("error", (err: Error) => {
      if (fileId) {
        storage.deleteFile(libraryId, fileId).catch(() => {});
      }
      reject(err);
    });

    event.node.req.pipe(busboy);
  });
}
