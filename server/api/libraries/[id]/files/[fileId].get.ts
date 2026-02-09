import { and, eq } from "drizzle-orm";
import mime from "mime/lite";
import { db, schema } from "~~/server/database";

function getDownloadName(name: string, mimeType: string) {
  const trimmed = name.trim();
  if (!trimmed) return "download";
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot > 0) return trimmed;
  const extension = mime.getExtension(mimeType);
  return extension ? `${trimmed}.${extension}` : trimmed;
}

function sanitizeAsciiFilename(value: string): string {
  const withoutControls = value.replace(/[\r\n]/g, "");
  const ascii = withoutControls.replace(/[^\x20-\x7E]/g, "_");
  const safe = ascii.replace(/["\\;]/g, "_").trim();
  return safe || "download";
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const fileId = getRouterParam(event, "fileId")!;
  const storage = useStorageService();

  const [file] = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.libraryId, libraryId)))
    .limit(1);

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  const fileExists = await storage.fileExists(file.libraryId, file.id);
  if (!fileExists) {
    throw createError({ statusCode: 404, statusMessage: "File content not found" });
  }

  const query = getQuery(event);
  const disposition = query.inline === "true" ? "inline" : "attachment";
  const downloadName = getDownloadName(file.name, file.mimeType);
  const asciiName = sanitizeAsciiFilename(downloadName);
  const utf8Name = encodeRFC5987(downloadName);
  const { size: totalSize } = await storage.fileStat(file.libraryId, file.id);

  setHeaders(event, {
    "Content-Type": file.mimeType,
    "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
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

      const boundedEnd = Math.min(end, totalSize - 1);
      if (start > boundedEnd) {
        setResponseStatus(event, 416);
        setHeader(event, "Content-Range", `bytes */${totalSize}`);
        return "";
      }

      setResponseStatus(event, 206);
      setHeaders(event, {
        "Content-Range": `bytes ${start}-${boundedEnd}/${totalSize}`,
        "Content-Length": String(boundedEnd - start + 1),
      });

      return sendStream(
        event,
        await storage.openFileReadStream(file.libraryId, file.id, { start, end: boundedEnd }),
      );
    }
  }

  setHeader(event, "Content-Length", totalSize);
  return sendStream(event, await storage.openFileReadStream(file.libraryId, file.id));
});
