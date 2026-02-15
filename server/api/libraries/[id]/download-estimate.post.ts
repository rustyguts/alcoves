import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";

interface EstimateBody {
  fileIds?: string[];
  folderIds?: string[];
}

async function countFolderSize(
  libraryId: string,
  folderId: string,
): Promise<{ totalSize: number; fileCount: number }> {
  let totalSize = 0;
  let fileCount = 0;

  const [fileStats] = await db
    .select({
      totalSize: sql<number>`coalesce(sum(${schema.files.size}), 0)`,
      fileCount: sql<number>`count(*)`,
    })
    .from(schema.files)
    .where(
      and(
        eq(schema.files.libraryId, libraryId),
        eq(schema.files.parentFolderId, folderId),
        eq(schema.files.trashedAt, null!),
      ),
    );

  totalSize += Number(fileStats?.totalSize ?? 0);
  fileCount += Number(fileStats?.fileCount ?? 0);

  const subfolders = await db
    .select({ id: schema.folders.id })
    .from(schema.folders)
    .where(
      and(
        eq(schema.folders.libraryId, libraryId),
        eq(schema.folders.parentFolderId, folderId),
        eq(schema.folders.trashedAt, null!),
      ),
    );

  for (const subfolder of subfolders) {
    const nested = await countFolderSize(libraryId, subfolder.id);
    totalSize += nested.totalSize;
    fileCount += nested.fileCount;
  }

  return { totalSize, fileCount };
}

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  await requireUserId(event);

  const body = await readBody<EstimateBody>(event);
  const fileIds = body?.fileIds ?? [];
  const folderIds = body?.folderIds ?? [];

  if (!fileIds.length && !folderIds.length) {
    return { totalSize: 0, fileCount: 0 };
  }

  let totalSize = 0;
  let fileCount = 0;

  if (fileIds.length) {
    const [stats] = await db
      .select({
        totalSize: sql<number>`coalesce(sum(${schema.files.size}), 0)`,
        fileCount: sql<number>`count(*)`,
      })
      .from(schema.files)
      .where(and(eq(schema.files.libraryId, libraryId), inArray(schema.files.id, fileIds)));

    totalSize += Number(stats?.totalSize ?? 0);
    fileCount += Number(stats?.fileCount ?? 0);
  }

  if (folderIds.length) {
    for (const folderId of folderIds) {
      const folderStats = await countFolderSize(libraryId, folderId);
      totalSize += folderStats.totalSize;
      fileCount += folderStats.fileCount;
    }
  }

  return { totalSize, fileCount };
});
