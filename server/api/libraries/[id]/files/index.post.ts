import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { assertFolderInLibrary, normalizeFolderId } from "~~/server/domain/library/folders";
import { isLibraryFaceRecognitionEnabled } from "~~/server/domain/library/faces";

/**
 * Streaming multipart file upload endpoint.
 *
 * Accepts a multipart/form-data POST with:
 *   - file:           the file blob (required)
 *   - name:           original filename (required)
 *   - mimeType:       MIME type string
 *   - lastModified:   epoch ms of the original file
 *   - parentFolderId: target folder UUID
 *
 * The file part is streamed directly to storage — the full file is never
 * buffered in server memory, so uploads of any size (up to 50 GB) work
 * without blowing the heap.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!;
  const userId = event.context.userId as string;
  const storage = useStorageService();

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, id))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  // Parse the multipart body — stream the file part directly to storage
  const { fields, fileSize } = await parseAndStoreUpload(event, storage, id);

  const name = fields.name?.trim() || "unnamed";
  const mimeType = fields.mimeType || "application/octet-stream";
  const originalCreatedAt = fields.lastModified || null;
  const parentFolderId = normalizeFolderId(fields.parentFolderId || null);

  if (parentFolderId) {
    await assertFolderInLibrary(id, parentFolderId);
  }

  try {
    const [file] = await db
      .insert(schema.files)
      .values({
        id: fields._fileId,
        libraryId: id,
        ownerId: userId,
        parentFolderId,
        name,
        mimeType,
        size: fileSize,
        originalCreatedAt: originalCreatedAt ? new Date(Number(originalCreatedAt)) : null,
      })
      .returning();

    // Enqueue face detection if applicable (non-blocking)
    if (file && file.mimeType.startsWith("image/")) {
      isLibraryFaceRecognitionEnabled(id)
        .then((enabled) => {
          if (enabled && file) {
            enqueueJob("{face-detection}", "detect-faces", {
              fileId: file.id,
              libraryId: id,
            });
          }
        })
        .catch(() => {});
    }

    // Enqueue video processing (thumbnail + proxy) for videos
    if (file && file.mimeType.startsWith("video/")) {
      db.update(schema.files)
        .set({ proxyStatus: "pending" })
        .where(eq(schema.files.id, file.id))
        .catch(() => {});

      if (isQueueConfigured()) {
        enqueueJob("{video-processing}", "process-video", {
          fileId: file.id,
          libraryId: id,
        }).catch(() => {});
      }
    }

    return file;
  } catch {
    await storage.deleteFile(id, fields._fileId);
    throw createError({ statusCode: 500, statusMessage: "Failed to save file record" });
  }
});

// ---------------------------------------------------------------------------
// Multipart streaming parser
// ---------------------------------------------------------------------------

interface ParsedUpload {
  fields: Record<string, string> & { _fileId: string };
  fileSize: number;
}

/**
 * Reads the multipart body from the request. Small text fields are buffered
 * normally, but the `file` part is piped directly into storage as a stream.
 * This means a 50 GB upload only uses a few KB of memory for the stream
 * buffers — the data flows from the network socket straight to disk/S3.
 */
async function parseAndStoreUpload(
  event: Parameters<typeof readRawBody>[0],
  storage: ReturnType<typeof useStorageService>,
  libraryId: string,
): Promise<ParsedUpload> {
  const contentType = getHeader(event, "content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    throw createError({ statusCode: 400, statusMessage: "Expected multipart/form-data" });
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!boundaryMatch) {
    throw createError({ statusCode: 400, statusMessage: "Missing multipart boundary" });
  }
  const boundary = (boundaryMatch[1] || boundaryMatch[2])!;

  // Use H3's readMultipartFormData for the parsing — it handles the boundary
  // protocol correctly. For most files this is fine since Bun's H3 adapter
  // can handle large bodies. The file data is received as a Buffer from
  // readMultipartFormData, but we immediately stream it to storage rather
  // than holding it for further processing.
  //
  // For truly enormous files (multi-GB), the web request body can be read as
  // a stream. We use a two-pass approach: first try to get the web Request
  // body stream for zero-copy streaming, falling back to readMultipartFormData.
  const fileId = randomUUID();
  const fields: Record<string, string> = {};
  let fileSize = 0;

  // Try the streaming path first — available when running on Bun
  const webRequest = toWebRequest(event);
  if (webRequest.body) {
    const result = await streamMultipartToStorage(
      webRequest.body,
      boundary,
      storage,
      libraryId,
      fileId,
    );
    Object.assign(fields, result.fields);
    fileSize = result.fileSize;
  } else {
    // Fallback: buffer-based parsing (for environments without streaming)
    const parts = await readMultipartFormData(event);
    if (!parts?.length) {
      throw createError({ statusCode: 400, statusMessage: "No upload data provided" });
    }

    for (const part of parts) {
      if (part.name === "file" && part.data) {
        fileSize = part.data.byteLength;
        await storage.storeFile(libraryId, fileId, Buffer.from(part.data));
      } else if (part.name && part.data) {
        fields[part.name] = part.data.toString("utf-8");
      }
    }
  }

  if (fileSize === 0) {
    // Clean up any partial file then error
    await storage.deleteFile(libraryId, fileId).catch(() => {});
    throw createError({ statusCode: 400, statusMessage: "No file data provided" });
  }

  return {
    fields: { ...fields, _fileId: fileId },
    fileSize,
  };
}

// ---------------------------------------------------------------------------
// Streaming multipart parser — zero-copy file upload
// ---------------------------------------------------------------------------

interface StreamResult {
  fields: Record<string, string>;
  fileSize: number;
}

/**
 * Parses a multipart/form-data stream, writing the `file` part directly to
 * storage as a ReadableStream while collecting text fields into a map.
 *
 * This parser is intentionally simple and handles the common case of a
 * FormData body with one file field and several text fields. It reads the
 * raw bytes, splits on the multipart boundary, and for the file part creates
 * a ReadableStream that is passed to storage.storeFileStream().
 */
async function streamMultipartToStorage(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  storage: ReturnType<typeof useStorageService>,
  libraryId: string,
  fileId: string,
): Promise<StreamResult> {
  const fields: Record<string, string> = {};
  let fileSize = 0;

  const delimiter = new TextEncoder().encode(`--${boundary}`);
  const headerEnd = new TextEncoder().encode("\r\n\r\n");

  const reader = body.getReader();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let buffer: any = new Uint8Array(0);

  // Use a wrapper object so TypeScript doesn't narrow the controller to `never`
  // inside closures. The controller is set by ReadableStream.start() callback.
  const pipe: { ctrl: ReadableStreamDefaultController<Uint8Array> | null } = { ctrl: null };

  let fileStreamPromise: Promise<number> | null = null;
  let inFilePart = false;
  let currentPartName = "";
  let currentPartIsFile = false;
  let textChunks: Uint8Array[] = [];

  function startFileStream() {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        pipe.ctrl = controller;
      },
    });
    fileStreamPromise = storage.storeFileStream(libraryId, fileId, stream);
    inFilePart = true;
  }

  function endFilePart() {
    if (pipe.ctrl) {
      pipe.ctrl.close();
      pipe.ctrl = null;
    }
    inFilePart = false;
  }

  function enqueueFileData(data: Uint8Array) {
    if (pipe.ctrl && data.byteLength > 0) {
      pipe.ctrl.enqueue(new Uint8Array(data));
      fileSize += data.byteLength;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer = concatBytes(buffer, value);
      }

      // Process all complete boundaries in the buffer
      while (true) {
        const boundaryIdx = indexOfBytes(buffer, delimiter);

        if (boundaryIdx === -1) {
          // No boundary found. If we're in the file part, flush all but the
          // last (delimiter.length + 4) bytes (to avoid splitting a boundary).
          if (inFilePart && pipe.ctrl) {
            const safeFlush = buffer.length - (delimiter.length + 4);
            if (safeFlush > 0) {
              enqueueFileData(buffer.slice(0, safeFlush));
              buffer = buffer.slice(safeFlush);
            }
          }
          break;
        }

        // We found a boundary. Everything before it belongs to the current part.
        const partData = buffer.slice(0, boundaryIdx);

        if (inFilePart && pipe.ctrl) {
          // Strip trailing \r\n before boundary
          const dataEnd = partData.length >= 2 ? partData.length - 2 : partData.length;
          if (dataEnd > 0) {
            enqueueFileData(partData.slice(0, dataEnd));
          }
          endFilePart();
        } else if (currentPartName && !currentPartIsFile && textChunks.length > 0) {
          // End of a text field — also strip trailing \r\n
          textChunks.push(partData);
          let combined = concatAll(textChunks);
          if (combined.length >= 2) {
            combined = combined.slice(0, combined.length - 2);
          }
          fields[currentPartName] = new TextDecoder().decode(combined);
          textChunks = [];
        }

        // Skip past boundary + possible \r\n or --
        let afterBoundary = boundaryIdx + delimiter.length;
        // Check for closing -- (end of multipart)
        if (
          buffer.length > afterBoundary + 1 &&
          buffer[afterBoundary] === 0x2d &&
          buffer[afterBoundary + 1] === 0x2d
        ) {
          buffer = new Uint8Array(0);
          break;
        }
        // Skip \r\n after boundary
        if (
          buffer.length > afterBoundary + 1 &&
          buffer[afterBoundary] === 0x0d &&
          buffer[afterBoundary + 1] === 0x0a
        ) {
          afterBoundary += 2;
        }
        buffer = buffer.slice(afterBoundary);

        // Now parse the headers of the new part
        const headerEndIdx = indexOfBytes(buffer, headerEnd);
        if (headerEndIdx !== -1) {
          const headers = parsePartHeaders(buffer.slice(0, headerEndIdx));
          currentPartName = headers.name;
          currentPartIsFile = headers.isFile;
          buffer = buffer.slice(headerEndIdx + headerEnd.length);

          if (currentPartIsFile) {
            startFileStream();
          } else {
            textChunks = [];
          }
        }
      }

      if (done) break;
    }

    // Finalize
    if (inFilePart) {
      endFilePart();
    }

    // Wait for the file to be fully written to storage
    if (fileStreamPromise) {
      const storedSize = await fileStreamPromise;
      if (storedSize > 0) {
        fileSize = storedSize;
      }
    }
  } catch (error: unknown) {
    if (pipe.ctrl) {
      try {
        pipe.ctrl.error(error);
      } catch {
        // ignore
      }
    }
    await storage.deleteFile(libraryId, fileId).catch(() => {});
    if (isAbortError(error)) {
      throw createError({ statusCode: 408, statusMessage: "Upload interrupted" });
    }
    throw error;
  }

  return { fields, fileSize };
}

function parsePartHeaders(headerBytes: Uint8Array): { name: string; isFile: boolean } {
  const headerStr = new TextDecoder().decode(headerBytes);
  const nameMatch = headerStr.match(/name="([^"]+)"/);
  const filenameMatch = headerStr.match(/filename="/);
  return {
    name: nameMatch?.[1] ?? "",
    isFile: !!filenameMatch,
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function concatAll(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "AbortError" || message.toLowerCase().includes("aborted");
}
