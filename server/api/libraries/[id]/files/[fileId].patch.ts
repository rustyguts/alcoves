import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, normalizeFolderId } from "~~/server/domain/library/folders";
import { parseBodyWithSchema } from "~~/server/utils/validation";

const updateFileSchema = z
  .object({
    name: z.string().optional(),
    parentFolderId: z.string().nullable().optional(),
  })
  .refine((data) => "name" in data || "parentFolderId" in data, {
    message: "No updates requested",
  });

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;
  const body = await parseBodyWithSchema(event, updateFileSchema);
  const nextName = typeof body?.name === "string" ? body.name.trim() : null;
  const parentFolderId =
    body && "parentFolderId" in body ? normalizeFolderId(body.parentFolderId) : undefined;

  if (!nextName && parentFolderId === undefined) {
    throw createError({ statusCode: 400, statusMessage: "No updates requested" });
  }

  if (body && "name" in body && !nextName) {
    throw createError({ statusCode: 400, statusMessage: "Name is required" });
  }

  if (parentFolderId) {
    await assertFolderInLibrary(libraryId, parentFolderId);
  }

  const update: Partial<(typeof schema.files)["$inferInsert"]> = {};
  if (nextName) {
    update.name = nextName;
  }
  if (parentFolderId !== undefined) {
    update.parentFolderId = parentFolderId;
  }

  const [file] = await db
    .update(schema.files)
    .set(update)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.libraryId, libraryId)))
    .returning();

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  return file;
});
