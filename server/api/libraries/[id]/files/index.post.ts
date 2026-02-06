import { addFile, getLibrary } from "~~/server/utils/store";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const library = getLibrary(id);
  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }
  const body = await readBody<{ name: string; mimeType: string; size: number }>(event);
  if (!body?.name) {
    throw createError({ statusCode: 400, statusMessage: "File name is required" });
  }
  return addFile(id, body.name, body.mimeType || "application/octet-stream", body.size || 0);
});
