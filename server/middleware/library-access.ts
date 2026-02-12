import { requireLibraryAccess, requireLibraryAdmin } from "~~/server/domain/library/access";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith("/api/libraries/")) return;

  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "libraries" || !parts[2]) return;

  const libraryId = parts[2];
  if (READ_METHODS.has(event.method)) {
    const access = await requireLibraryAccess(event, libraryId);
    event.context.libraryAccess = access;
    return;
  }

  const access = await requireLibraryAdmin(event, libraryId);
  event.context.libraryAccess = access;
});
