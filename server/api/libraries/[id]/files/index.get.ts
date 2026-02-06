import { getFiles, getLibrary } from "~~/server/utils/store";

export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id")!;
  const library = getLibrary(id);
  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }
  return getFiles(id);
});
