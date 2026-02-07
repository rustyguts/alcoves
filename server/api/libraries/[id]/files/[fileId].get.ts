import { and, eq } from "drizzle-orm";
import mime from "mime/lite";
import { createReadStream, existsSync, statSync } from "node:fs";
import { db, schema } from "~~/server/database";

function getDownloadName(name: string, mimeType: string) {
  const trimmed = name.trim();
  if (!trimmed) return "download";
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot > 0) return trimmed;
  const extension = mime.getExtension(mimeType);
  return extension ? `${trimmed}.${extension}` : trimmed;
}

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;

  const [file] = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.libraryId, libraryId)))
    .limit(1);

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  const blobPath = getFileBlobPath(file.libraryId, file.id);
  if (!existsSync(blobPath)) {
    throw createError({ statusCode: 404, statusMessage: "File content not found" });
  }

  const query = getQuery(event);
  const disposition = query.inline === "true" ? "inline" : "attachment";
  const downloadName = getDownloadName(file.name, file.mimeType);
  const stat = statSync(blobPath);
  const totalSize = stat.size;

  setHeaders(event, {
    "Content-Type": file.mimeType,
    "Content-Disposition": `${disposition}; filename="${encodeURIComponent(downloadName)}"`,
    "Accept-Ranges": "bytes",
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

      setResponseStatus(event, 206);
      setHeaders(event, {
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Content-Length": String(end - start + 1),
      });

      return sendStream(event, createReadStream(blobPath, { start, end }));
    }
  }

  setHeader(event, "Content-Length", totalSize);
  return sendStream(event, createReadStream(blobPath));
});
