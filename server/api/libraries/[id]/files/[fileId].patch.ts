import { renameFile } from "~~/server/utils/store";

export default defineEventHandler(async (event) => {
  const fileId = getRouterParam(event, "fileId")!;
  const body = await readBody<{ name: string }>(event);
  if (!body?.name) {
    throw createError({ statusCode: 400, statusMessage: "Name is required" });
  }
  const file = renameFile(fileId, body.name);
  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }
  return file;
});
