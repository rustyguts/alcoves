import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { videoProxyKey } from "~~/server/services/video/worker";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;
  const storage = useStorageService();

  const [file] = await db
    .select({
      id: schema.files.id,
      mimeType: schema.files.mimeType,
      proxyStatus: schema.files.proxyStatus,
    })
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.libraryId, libraryId)))
    .limit(1);

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  // If no proxy needed, redirect to the original file endpoint
  if (file.proxyStatus === "not_needed") {
    return sendRedirect(event, `/api/libraries/${libraryId}/files/${fileId}?inline=true`);
  }

  if (file.proxyStatus !== "ready") {
    throw createError({
      statusCode: 404,
      statusMessage: file.proxyStatus === "processing" ? "Proxy is still processing" : "No proxy available",
    });
  }

  const cacheKey = videoProxyKey(libraryId, fileId);
  if (!(await storage.cacheExists(cacheKey))) {
    throw createError({ statusCode: 404, statusMessage: "Proxy file not found" });
  }

  // We need to get the size for range requests. Read into buffer stat is not available on cache,
  // so we'll read the cache stream and get size from the stat if possible.
  // For cache scope, we need to add a cacheStat method or use a workaround.
  // Simplest: read into buffer to get the size, then serve with range support.
  // For large proxies this is not ideal, but proxy files are typically < 2GB.

  const proxyBuffer = await storage.readCacheBuffer(cacheKey);
  const totalSize = proxyBuffer.byteLength;

  setHeaders(event, {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });

  const rangeHeader = getRequestHeader(event, "range");
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match && match[1]) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (start >= totalSize) {
        setResponseStatus(event, 416);
        setHeader(event, "Content-Range", `bytes */${totalSize}`);
        return "";
      }

      const boundedEnd = Math.min(end, totalSize - 1);
      setResponseStatus(event, 206);
      setHeaders(event, {
        "Content-Range": `bytes ${start}-${boundedEnd}/${totalSize}`,
        "Content-Length": String(boundedEnd - start + 1),
      });

      return proxyBuffer.subarray(start, boundedEnd + 1);
    }
  }

  setHeader(event, "Content-Length", totalSize);
  return proxyBuffer;
});
