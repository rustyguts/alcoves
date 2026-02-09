import { and, eq } from "drizzle-orm";
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
  v: z.string().optional(),
});

type ProxyOptions = z.infer<typeof querySchema>;

const MIME_TYPES: Record<ProxyOptions["format"], string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
};

function getCacheKey(sourceKey: string, options: ProxyOptions): string {
  const params: [string, string][] = [
    ["f", options.format],
    ["q", String(options.quality)],
  ];
  if (options.width) params.push(["w", String(options.width)]);
  if (options.height) params.push(["h", String(options.height)]);
  if (options.v) params.push(["v", options.v]);

  // Sort for consistent cache keys regardless of query param order.
  params.sort(([a], [b]) => a.localeCompare(b));
  const paramString = new URLSearchParams(params).toString();

  return `${sourceKey}/${paramString}.${options.format}`;
}

type FileSource = {
  kind: "file";
  libraryId: string;
  fileId: string;
  sourceKey: string;
};

type AvatarSource = {
  kind: "avatar";
  userId: string;
  sourceKey: string;
};

type MediaSource = FileSource | AvatarSource;

async function resolveMediaSource(pathParam: string): Promise<MediaSource> {
  const parts = pathParam.split("/").filter(Boolean);

  if (parts[0] === "avatar" && parts.length === 2) {
    const userId = parts[1];
    if (!userId) {
      throw createError({ statusCode: 400, statusMessage: "Invalid avatar path format" });
    }

    return {
      kind: "avatar",
      userId,
      sourceKey: `avatar/${userId}`,
    };
  }

  if (parts[0] === "file" && parts.length === 3) {
    const libraryId = parts[1];
    const fileId = parts[2];

    if (!libraryId || !fileId) {
      throw createError({ statusCode: 400, statusMessage: "Invalid file path format" });
    }

    return {
      kind: "file",
      libraryId,
      fileId,
      sourceKey: `file/${libraryId}/${fileId}`,
    };
  }

  // Backward compatibility for existing URLs: /api/files/proxy/{libraryId}/{fileId}
  if (parts.length === 2) {
    const libraryId = parts[0];
    const fileId = parts[1];

    if (!libraryId || !fileId) {
      throw createError({ statusCode: 400, statusMessage: "Invalid file path format" });
    }

    return {
      kind: "file",
      libraryId,
      fileId,
      sourceKey: `file/${libraryId}/${fileId}`,
    };
  }

  throw createError({
    statusCode: 400,
    statusMessage:
      "Invalid path. Use /api/files/proxy/file/{libraryId}/{fileId} or /api/files/proxy/avatar/{userId}",
  });
}

export default defineEventHandler(async (event) => {
  // TODO: Add authentication check - currently skipped in server/middleware/auth.ts
  const storage = useStorageService();

  const pathParam = getRouterParam(event, "path");
  if (!pathParam) {
    throw createError({ statusCode: 400, statusMessage: "Path required" });
  }

  const mediaSource = await resolveMediaSource(pathParam);

  // Validate query params with zod.
  const query = getQuery(event);
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  const options = parsed.data;

  if (mediaSource.kind === "file") {
    // Look up the file record and ensure it's an image.
    const [file] = await db
      .select({
        id: schema.files.id,
        libraryId: schema.files.libraryId,
        mimeType: schema.files.mimeType,
      })
      .from(schema.files)
      .where(
        and(
          eq(schema.files.id, mediaSource.fileId),
          eq(schema.files.libraryId, mediaSource.libraryId),
        ),
      )
      .limit(1);

    if (!file) {
      throw createError({ statusCode: 404, statusMessage: "File not found" });
    }

    if (!file.mimeType.startsWith("image/")) {
      throw createError({ statusCode: 400, statusMessage: "File is not an image" });
    }
  }

  const cacheKey = getCacheKey(mediaSource.sourceKey, options);
  if (await storage.cacheExists(cacheKey)) {
    setHeaders(event, {
      "Content-Type": MIME_TYPES[options.format],
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    return sendStream(event, await storage.openCacheReadStream(cacheKey));
  }

  let sourceBuffer: Buffer;
  if (mediaSource.kind === "file") {
    const sourceExists = await storage.fileExists(mediaSource.libraryId, mediaSource.fileId);
    if (!sourceExists) {
      throw createError({ statusCode: 404, statusMessage: "Media content not found" });
    }
    sourceBuffer = await storage.readFileBuffer(mediaSource.libraryId, mediaSource.fileId);
  } else {
    const sourceExists = await storage.avatarExists(mediaSource.userId);
    if (!sourceExists) {
      throw createError({ statusCode: 404, statusMessage: "Media content not found" });
    }
    sourceBuffer = await storage.readAvatarBuffer(mediaSource.userId);
  }

  // Build the sharp pipeline - always auto-rotate from EXIF.
  let imagePipeline = sharp(sourceBuffer).rotate();

  if (options.width || options.height) {
    imagePipeline = imagePipeline.resize(options.width, options.height, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  switch (options.format) {
    case "webp":
      imagePipeline = imagePipeline.webp({ quality: options.quality });
      break;
    case "avif":
      imagePipeline = imagePipeline.avif({ quality: options.quality });
      break;
    case "jpeg":
      imagePipeline = imagePipeline.jpeg({ quality: options.quality, progressive: true });
      break;
    case "png":
      imagePipeline = imagePipeline.png({ compressionLevel: 6 });
      break;
  }

  const processedBuffer = await imagePipeline.toBuffer();
  await storage.storeCacheBuffer(cacheKey, processedBuffer);

  setHeaders(event, {
    "Content-Type": MIME_TYPES[options.format],
    "Cache-Control": "public, max-age=31536000, immutable",
  });

  return processedBuffer;
});
