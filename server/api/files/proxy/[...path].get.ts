import { eq } from "drizzle-orm";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { db, schema } from "~~/server/database";
import sharp from "sharp";
import * as z from "zod";

const MAX_DIMENSION = 4096;
const ALLOWED_FORMATS = ["webp", "avif", "jpeg", "png"] as const;

const querySchema = z.object({
  format: z.enum(ALLOWED_FORMATS).default("webp"),
  width: z.coerce.number().int().min(1).max(MAX_DIMENSION).optional(),
  height: z.coerce.number().int().min(1).max(MAX_DIMENSION).optional(),
  quality: z.coerce.number().int().min(1).max(100).default(80),
});

type ProxyOptions = z.infer<typeof querySchema>;

const MIME_TYPES: Record<ProxyOptions["format"], string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
};

function getCacheDir(): string {
  const config = useRuntimeConfig();
  return join(config.storagePath, ".cache");
}

function getCacheKey(libraryId: string, fileId: string, options: ProxyOptions): string {
  const params: [string, string][] = [
    ["f", options.format],
    ["q", String(options.quality)],
  ];
  if (options.width) params.push(["w", String(options.width)]);
  if (options.height) params.push(["h", String(options.height)]);

  // Sort for consistent cache keys regardless of query param order
  params.sort(([a], [b]) => a.localeCompare(b));
  const paramString = new URLSearchParams(params).toString();

  return `${libraryId}/${fileId}/${paramString}.${options.format}`;
}

function getCachePath(cacheKey: string): string {
  return join(getCacheDir(), cacheKey);
}

export default defineEventHandler(async (event) => {
  // TODO: Add authentication check — currently skipped in server/middleware/auth.ts

  const pathParam = getRouterParam(event, "path");
  if (!pathParam) {
    throw createError({ statusCode: 400, statusMessage: "Path required" });
  }

  const parts = pathParam.split("/");
  if (parts.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid path. Expected: /api/files/proxy/{libraryId}/{fileId}",
    });
  }

  const [libraryId, fileId] = parts;
  if (!libraryId || !fileId) {
    throw createError({ statusCode: 400, statusMessage: "Invalid path format" });
  }

  // Validate query params with zod
  const query = getQuery(event);
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const options = parsed.data;

  // Look up the file record and ensure it's an image
  const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: "File not found" });
  }

  if (!file.mimeType.startsWith("image/")) {
    throw createError({ statusCode: 400, statusMessage: "File is not an image" });
  }

  // Serve from cache if it already exists
  const cacheKey = getCacheKey(libraryId, fileId, options);
  const cachePath = getCachePath(cacheKey);

  if (existsSync(cachePath)) {
    setHeaders(event, {
      "Content-Type": MIME_TYPES[options.format],
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    return sendStream(event, createReadStream(cachePath));
  }

  // Verify the source blob exists on disk
  const sourcePath = getFileBlobPath(file.libraryId, file.id);
  if (!existsSync(sourcePath)) {
    throw createError({ statusCode: 404, statusMessage: "File content not found on disk" });
  }

  // Build the sharp pipeline — always auto-rotate from EXIF
  let pipeline = sharp(sourcePath).rotate();

  if (options.width || options.height) {
    pipeline = pipeline.resize(options.width, options.height, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  switch (options.format) {
    case "webp":
      pipeline = pipeline.webp({ quality: options.quality });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality: options.quality });
      break;
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: options.quality, progressive: true });
      break;
    case "png":
      pipeline = pipeline.png({ compressionLevel: 6 });
      break;
  }

  const processedBuffer = await pipeline.toBuffer();

  // Write to cache for subsequent requests
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, processedBuffer);

  setHeaders(event, {
    "Content-Type": MIME_TYPES[options.format],
    "Cache-Control": "public, max-age=31536000, immutable",
  });

  return processedBuffer;
});
