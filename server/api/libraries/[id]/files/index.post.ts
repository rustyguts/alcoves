import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getRequestWebStream } from "h3";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, normalizeFolderId } from "~~/server/domain/library/folders";

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

async function parseUpload(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  libraryId: string,
  storage: ReturnType<typeof useStorageService>,
) {
  const contentType = getHeader(event, "content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw createError({ statusCode: 400, statusMessage: "Expected multipart/form-data upload" });
  }

  const requestStream = getRequestWebStream(event);
  if (!requestStream) {
    throw createError({ statusCode: 400, statusMessage: "No upload data provided" });
  }

  const request = new Request("http://localhost/upload", {
    method: event.method,
    headers: {
      "content-type": contentType,
    },
    body: requestStream,
    duplex: "half",
  } as RequestInit);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid multipart upload data",
    });
  }

  const filePart = formData.get("file");
  if (!(filePart instanceof File)) {
    throw createError({ statusCode: 400, statusMessage: "No file uploaded" });
  }

  const fileId = randomUUID();
  try {
    const size = await storage.storeFileStream(
      libraryId,
      fileId,
      filePart.stream() as ReadableStream<Uint8Array>,
    );

    const getField = (name: string): string | null => {
      const value = formData.get(name);
      return typeof value === "string" ? value : null;
    };

    return {
      fileId,
      name: getField("name") || filePart.name || "unnamed",
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
