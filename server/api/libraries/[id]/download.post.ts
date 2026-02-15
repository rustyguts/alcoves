import { and, eq, inArray } from "drizzle-orm";
import archiver from "archiver";
import { Readable } from "node:stream";
import { db, schema } from "~~/server/database";

const MAX_ZIP_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
const MAX_FILE_COUNT = 10_000;

interface DownloadBody {
  fileIds?: string[];
  folderIds?: string[];
  skipSizeCheck?: boolean;
}

interface FileRecord {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  libraryId: string;
  parentFolderId: string | null;
}

interface FolderRecord {
  id: string;
  name: string;
  parentFolderId: string | null;
}

async function getFilesInFolder(libraryId: string, folderId: string): Promise<FileRecord[]> {
  return db
    .select({
      id: schema.files.id,
      name: schema.files.name,
      mimeType: schema.files.mimeType,
      size: schema.files.size,
      libraryId: schema.files.libraryId,
      parentFolderId: schema.files.parentFolderId,
    })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.libraryId, libraryId),
        eq(schema.files.parentFolderId, folderId),
        eq(schema.files.trashedAt, null!),
      ),
    );
}

async function getSubfolders(libraryId: string, folderId: string): Promise<FolderRecord[]> {
  return db
    .select({
      id: schema.folders.id,
      name: schema.folders.name,
      parentFolderId: schema.folders.parentFolderId,
    })
    .from(schema.folders)
    .where(
      and(
        eq(schema.folders.libraryId, libraryId),
        eq(schema.folders.parentFolderId, folderId),
        eq(schema.folders.trashedAt, null!),
      ),
    );
}

async function collectFolderFiles(
  libraryId: string,
  folderId: string,
  prefix: string,
): Promise<{ path: string; file: FileRecord }[]> {
  const result: { path: string; file: FileRecord }[] = [];

  const files = await getFilesInFolder(libraryId, folderId);
  for (const file of files) {
    result.push({ path: `${prefix}${file.name}`, file });
  }

  const subfolders = await getSubfolders(libraryId, folderId);
  for (const subfolder of subfolders) {
    const nested = await collectFolderFiles(libraryId, subfolder.id, `${prefix}${subfolder.name}/`);
    result.push(...nested);
  }

  return result;
}

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  await requireUserId(event);

  const body = await readBody<DownloadBody>(event);
  const fileIds = body?.fileIds ?? [];
  const folderIds = body?.folderIds ?? [];

  if (!fileIds.length && !folderIds.length) {
    throw createError({ statusCode: 400, statusMessage: "No files or folders specified" });
  }

  const storage = useStorageService();

  // Collect all files to include in the zip
  const zipEntries: { path: string; file: FileRecord }[] = [];

  // Add directly selected files
  if (fileIds.length) {
    const selectedFiles = await db
      .select({
        id: schema.files.id,
        name: schema.files.name,
        mimeType: schema.files.mimeType,
        size: schema.files.size,
        libraryId: schema.files.libraryId,
        parentFolderId: schema.files.parentFolderId,
      })
      .from(schema.files)
      .where(and(eq(schema.files.libraryId, libraryId), inArray(schema.files.id, fileIds)));

    for (const file of selectedFiles) {
      zipEntries.push({ path: file.name, file });
    }
  }

  // Add files from selected folders (recursively)
  if (folderIds.length) {
    const selectedFolders = await db
      .select({
        id: schema.folders.id,
        name: schema.folders.name,
        parentFolderId: schema.folders.parentFolderId,
      })
      .from(schema.folders)
      .where(and(eq(schema.folders.libraryId, libraryId), inArray(schema.folders.id, folderIds)));

    for (const folder of selectedFolders) {
      const folderFiles = await collectFolderFiles(libraryId, folder.id, `${folder.name}/`);
      zipEntries.push(...folderFiles);
    }
  }

  if (!zipEntries.length) {
    throw createError({ statusCode: 404, statusMessage: "No files found to download" });
  }

  if (zipEntries.length > MAX_FILE_COUNT) {
    throw createError({
      statusCode: 400,
      statusMessage: `Too many files (${zipEntries.length}). Maximum is ${MAX_FILE_COUNT}.`,
    });
  }

  // Calculate total size estimate
  const totalSize = zipEntries.reduce((sum, entry) => sum + entry.file.size, 0);

  if (totalSize > MAX_ZIP_SIZE_BYTES && !body?.skipSizeCheck) {
    throw createError({
      statusCode: 413,
      statusMessage: "Download too large",
      data: {
        totalSize,
        maxSize: MAX_ZIP_SIZE_BYTES,
        fileCount: zipEntries.length,
      },
    });
  }

  // Deduplicate paths (in case of name conflicts)
  const usedPaths = new Set<string>();
  for (const entry of zipEntries) {
    let path = entry.path;
    if (usedPaths.has(path)) {
      const lastDot = path.lastIndexOf(".");
      const base = lastDot > 0 ? path.slice(0, lastDot) : path;
      const ext = lastDot > 0 ? path.slice(lastDot) : "";
      let counter = 1;
      while (usedPaths.has(path)) {
        path = `${base} (${counter})${ext}`;
        counter++;
      }
      entry.path = path;
    }
    usedPaths.add(path);
  }

  // Set up streaming zip response
  const archive = archiver("zip", { store: true });

  setResponseHeader(event, "Content-Type", "application/zip");
  setResponseHeader(event, "Content-Disposition", 'attachment; filename="download.zip"');

  // Pipe archiver to response
  const nodeRes = event.node.res;
  archive.pipe(nodeRes);

  // Add files to archive
  for (const entry of zipEntries) {
    try {
      const fileStream = await storage.openFileReadStream(entry.file.libraryId, entry.file.id);
      const nodeReadable = Readable.fromWeb(
        fileStream as unknown as import("stream/web").ReadableStream,
      );
      archive.append(nodeReadable, { name: entry.path });
    } catch {
      // Skip files that can't be read (deleted from storage)
      console.warn(`[download] Skipping missing file ${entry.file.id}`);
    }
  }

  await archive.finalize();

  event._handled = true;
});
