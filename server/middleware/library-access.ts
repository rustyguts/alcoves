import { requireLibraryAccess, requireLibraryAdmin } from "~~/server/utils/libraries";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith("/api/libraries/")) return;

  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "libraries" || !parts[2]) return;

  const libraryId = parts[2];
  if (READ_METHODS.has(event.method)) {
    await requireLibraryAccess(event, libraryId);
    return;
  }

  await requireLibraryAdmin(event, libraryId);
});
