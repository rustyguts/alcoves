import { renameLibrary } from "~~/server/utils/store";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const body = await readBody<{ name: string }>(event);
  if (!body?.name) {
    throw createError({ statusCode: 400, statusMessage: "Name is required" });
  }
  const library = renameLibrary(id, body.name);
  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }
  return library;
});
