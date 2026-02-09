import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { getFolderBreadcrumbs, normalizeFolderId } from "~~/server/domain/library/folders";
import type { LibraryTag, PaginatedFiles } from "~~/shared/types/api";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface CursorPayload {
  kindRank: number;
  sortName: string;
  id: string;
}

interface ListingRow {
  id: string;
  libraryId: string;
  parentFolderId: string | null;
  ownerId: string | null;
  name: string;
  kind: "folder" | "file";
  kindRank: number;
  sortName: string;
  mimeType: string | null;
  size: number | null;
  originalCreatedAt: Date | null;
  trashedAt: Date | null;
  trashFileCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

async function getTrashedFolderFileCounts(libraryId: string, rootFolderIds: string[]) {
  const counts = new Map<string, number>();
  if (!rootFolderIds.length) return counts;

  const allFolders = await db
    .select({
      id: schema.folders.id,
      parentFolderId: schema.folders.parentFolderId,
    })
    .from(schema.folders)
    .where(eq(schema.folders.libraryId, libraryId));

  const childrenByParent = new Map<string, string[]>();
  for (const folder of allFolders) {
    if (!folder.parentFolderId) continue;
    const list = childrenByParent.get(folder.parentFolderId) ?? [];
    list.push(folder.id);
    childrenByParent.set(folder.parentFolderId, list);
  }

  const subtreeByRoot = new Map<string, string[]>();
  const allSubtreeFolderIds = new Set<string>();

  for (const rootId of rootFolderIds) {
    const subtree: string[] = [];
    const visited = new Set<string>();
    const stack = [rootId];

    while (stack.length) {
      const folderId = stack.pop()!;
      if (visited.has(folderId)) continue;
      visited.add(folderId);
      subtree.push(folderId);
      allSubtreeFolderIds.add(folderId);

      const children = childrenByParent.get(folderId) ?? [];
      stack.push(...children);
    }

    subtreeByRoot.set(rootId, subtree);
  }

  const groupedFileCounts = allSubtreeFolderIds.size
    ? await db
        .select({
          parentFolderId: schema.files.parentFolderId,
          value: count(),
        })
        .from(schema.files)
        .where(
          and(
            eq(schema.files.libraryId, libraryId),
            inArray(schema.files.parentFolderId, Array.from(allSubtreeFolderIds)),
          ),
        )
        .groupBy(schema.files.parentFolderId)
    : [];

  const countByFolderId = new Map<string, number>();
  for (const row of groupedFileCounts) {
    if (!row.parentFolderId) continue;
    countByFolderId.set(row.parentFolderId, row.value);
  }

  for (const rootId of rootFolderIds) {
    const subtree = subtreeByRoot.get(rootId) ?? [];
    const total = subtree.reduce((sum, folderId) => sum + (countByFolderId.get(folderId) ?? 0), 0);
    counts.set(rootId, total);
  }

  return counts;
}

function parseCursor(cursor: unknown): CursorPayload | null {
  if (typeof cursor !== "string" || !cursor) return null;

  try {
    const decoded = JSON.parse(atob(cursor)) as CursorPayload;
    if (
      typeof decoded.id !== "string" ||
      typeof decoded.sortName !== "string" ||
      (decoded.kindRank !== 0 && decoded.kindRank !== 1)
    ) {
      throw new Error("Invalid cursor payload");
    }
    return decoded;
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid cursor" });
  }
}

export async function listLibraryFiles(
  libraryId: string,
  query: Record<string, unknown>,
): Promise<PaginatedFiles> {
  const showTrashed = query.trashed === "true";
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const requestedFolderId = normalizeFolderId(query.folder);
  const currentFolderId = showTrashed ? null : requestedFolderId;

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const breadcrumbs = showTrashed
    ? []
    : await getFolderBreadcrumbs(libraryId, currentFolderId ?? null);

  const folderWhere = and(
    eq(schema.folders.libraryId, libraryId),
    showTrashed
      ? and(
          isNotNull(schema.folders.trashedAt),
          or(
            isNull(schema.folders.parentFolderId),
            sql<boolean>`not exists (
              select 1
              from folders parent_folder
              where parent_folder.id = ${schema.folders.parentFolderId}
                and parent_folder.trashed_at is not null
            )`,
          ),
        )
      : and(
          isNull(schema.folders.trashedAt),
          currentFolderId
            ? eq(schema.folders.parentFolderId, currentFolderId)
            : isNull(schema.folders.parentFolderId),
        ),
  );

  const fileBaseWhere = and(
    eq(schema.files.libraryId, libraryId),
    showTrashed ? isNotNull(schema.files.trashedAt) : isNull(schema.files.trashedAt),
    showTrashed
      ? or(
          isNull(schema.files.parentFolderId),
          sql<boolean>`not exists (
            select 1
            from folders trashed_parent
            where trashed_parent.id = ${schema.files.parentFolderId}
              and trashed_parent.trashed_at is not null
          )`,
        )
      : currentFolderId
        ? eq(schema.files.parentFolderId, currentFolderId)
        : isNull(schema.files.parentFolderId),
  );

  const decodedCursor = query.cursor ? parseCursor(query.cursor) : null;

  const folderCursorWhere =
    decodedCursor?.kindRank === 0
      ? or(
          sql<boolean>`lower(${schema.folders.name}) > ${decodedCursor.sortName}`,
          and(
            eq(sql<string>`lower(${schema.folders.name})`, decodedCursor.sortName),
            sql<boolean>`${schema.folders.id} > ${decodedCursor.id}`,
          ),
        )
      : decodedCursor
        ? sql`false`
        : undefined;

  const fileCursorWhere =
    decodedCursor?.kindRank === 0
      ? sql`true`
      : decodedCursor
        ? or(
            sql<boolean>`lower(${schema.files.name}) > ${decodedCursor.sortName}`,
            and(
              eq(sql<string>`lower(${schema.files.name})`, decodedCursor.sortName),
              sql<boolean>`${schema.files.id} > ${decodedCursor.id}`,
            ),
          )
        : undefined;

  const [folderCountResult, fileCountResult, folderRows, fileRows] = await Promise.all([
    db.select({ value: count() }).from(schema.folders).where(folderWhere),
    db.select({ value: count() }).from(schema.files).where(fileBaseWhere),
    db
      .select({
        id: schema.folders.id,
        libraryId: schema.folders.libraryId,
        parentFolderId: schema.folders.parentFolderId,
        ownerId: sql<string | null>`NULL`,
        name: schema.folders.name,
        kind: sql<"folder">`'folder'`,
        kindRank: sql<number>`0`,
        sortName: sql<string>`lower(${schema.folders.name})`,
        mimeType: sql<string | null>`NULL`,
        size: sql<number | null>`NULL`,
        originalCreatedAt: sql<Date | null>`NULL`,
        trashedAt: schema.folders.trashedAt,
        trashFileCount: sql<number | null>`NULL`,
        createdAt: schema.folders.createdAt,
        updatedAt: schema.folders.updatedAt,
      })
      .from(schema.folders)
      .where(and(folderWhere, folderCursorWhere))
      .orderBy(asc(sql<string>`lower(${schema.folders.name})`), asc(schema.folders.id))
      .limit(limit + 1),
    db
      .select({
        id: schema.files.id,
        libraryId: schema.files.libraryId,
        parentFolderId: schema.files.parentFolderId,
        ownerId: schema.files.ownerId,
        name: schema.files.name,
        kind: sql<"file">`'file'`,
        kindRank: sql<number>`1`,
        sortName: sql<string>`lower(${schema.files.name})`,
        mimeType: schema.files.mimeType,
        size: schema.files.size,
        originalCreatedAt: schema.files.originalCreatedAt,
        trashedAt: schema.files.trashedAt,
        trashFileCount: sql<number | null>`NULL`,
        createdAt: schema.files.createdAt,
        updatedAt: schema.files.updatedAt,
      })
      .from(schema.files)
      .where(and(fileBaseWhere, fileCursorWhere))
      .orderBy(asc(sql<string>`lower(${schema.files.name})`), asc(schema.files.id))
      .limit(limit + 1),
  ]);

  const totalCount = (folderCountResult[0]?.value ?? 0) + (fileCountResult[0]?.value ?? 0);

  const combined: ListingRow[] = [...folderRows, ...fileRows].sort((a, b) => {
    if (a.kindRank !== b.kindRank) return a.kindRank - b.kindRank;
    if (a.sortName !== b.sortName) return a.sortName.localeCompare(b.sortName);
    return a.id.localeCompare(b.id);
  });

  const hasMore = combined.length > limit;
  const entries = hasMore ? combined.slice(0, limit) : combined;

  const fileIds = entries.filter((entry) => entry.kind === "file").map((entry) => entry.id);
  const folderIds = entries.filter((entry) => entry.kind === "folder").map((entry) => entry.id);
  const ownerIds = Array.from(
    new Set(entries.filter((entry) => entry.kind === "file").map((entry) => entry.ownerId)),
  ).filter((ownerId): ownerId is string => Boolean(ownerId));

  const tagRows = fileIds.length
    ? await db
        .select({
          fileId: schema.fileTags.fileId,
          id: schema.tags.id,
          libraryId: schema.tags.libraryId,
          name: schema.tags.name,
          color: schema.tags.color,
          createdAt: schema.tags.createdAt,
          updatedAt: schema.tags.updatedAt,
        })
        .from(schema.fileTags)
        .innerJoin(schema.tags, eq(schema.tags.id, schema.fileTags.tagId))
        .where(inArray(schema.fileTags.fileId, fileIds))
    : [];

  const folderTagRows = folderIds.length
    ? await db
        .select({
          folderId: schema.folderTags.folderId,
          id: schema.tags.id,
          libraryId: schema.tags.libraryId,
          name: schema.tags.name,
          color: schema.tags.color,
          createdAt: schema.tags.createdAt,
          updatedAt: schema.tags.updatedAt,
        })
        .from(schema.folderTags)
        .innerJoin(schema.tags, eq(schema.tags.id, schema.folderTags.tagId))
        .where(inArray(schema.folderTags.folderId, folderIds))
    : [];

  const ownerRows = ownerIds.length
    ? await db
        .select({
          id: schema.users.id,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, ownerIds))
    : [];

  const tagsByFileId = new Map<string, LibraryTag[]>();
  for (const tagRow of tagRows) {
    const list = tagsByFileId.get(tagRow.fileId) ?? [];
    list.push({
      id: tagRow.id,
      libraryId: tagRow.libraryId,
      name: tagRow.name,
      color: tagRow.color,
      createdAt: tagRow.createdAt.toISOString(),
      updatedAt: tagRow.updatedAt.toISOString(),
    });
    tagsByFileId.set(tagRow.fileId, list);
  }

  const tagsByFolderId = new Map<string, LibraryTag[]>();
  for (const tagRow of folderTagRows) {
    const list = tagsByFolderId.get(tagRow.folderId) ?? [];
    list.push({
      id: tagRow.id,
      libraryId: tagRow.libraryId,
      name: tagRow.name,
      color: tagRow.color,
      createdAt: tagRow.createdAt.toISOString(),
      updatedAt: tagRow.updatedAt.toISOString(),
    });
    tagsByFolderId.set(tagRow.folderId, list);
  }

  const ownersById = new Map(
    ownerRows.map((owner) => [
      owner.id,
      {
        id: owner.id,
        displayName: owner.displayName,
        avatarUrl: owner.avatarUrl,
      },
    ]),
  );

  const trashedFolderFileCounts = showTrashed
    ? await getTrashedFolderFileCounts(libraryId, folderIds)
    : new Map<string, number>();

  const lastEntry = entries[entries.length - 1];
  const nextCursor =
    hasMore && lastEntry
      ? btoa(
          JSON.stringify({
            kindRank: lastEntry.kindRank,
            sortName: lastEntry.sortName,
            id: lastEntry.id,
          } satisfies CursorPayload),
        )
      : null;

  return {
    entries: entries.map((entry) => {
      if (entry.kind === "folder") {
        return {
          id: entry.id,
          libraryId: entry.libraryId,
          parentFolderId: entry.parentFolderId,
          name: entry.name,
          kind: "folder",
          trashedAt: entry.trashedAt ? entry.trashedAt.toISOString() : null,
          trashFileCount: showTrashed ? (trashedFolderFileCounts.get(entry.id) ?? 0) : undefined,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
          tags: (tagsByFolderId.get(entry.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
        };
      }

      return {
        id: entry.id,
        libraryId: entry.libraryId,
        parentFolderId: entry.parentFolderId,
        name: entry.name,
        kind: "file",
        mimeType: entry.mimeType ?? "application/octet-stream",
        size: entry.size ?? 0,
        originalCreatedAt: entry.originalCreatedAt ? entry.originalCreatedAt.toISOString() : null,
        trashedAt: entry.trashedAt ? entry.trashedAt.toISOString() : null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
        owner: entry.ownerId ? (ownersById.get(entry.ownerId) ?? null) : null,
        tags: (tagsByFileId.get(entry.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      };
    }),
    nextCursor,
    totalCount,
    breadcrumbs,
    currentFolderId,
  };
}
