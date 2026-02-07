import { eq, and, isNull, isNotNull, desc, sql, lt, or, count, inArray } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import type { PaginatedFiles } from "~~/server/utils/types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export default defineEventHandler(async (event): Promise<PaginatedFiles> => {
  const id = getRouterParam(event, "id")!;
  const query = getQuery(event);
  const showTrashed = query.trashed === "true";
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const [library] = await db
    .select({ id: schema.libraries.id })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, id))
    .limit(1);

  if (!library) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const trashFilter = showTrashed
    ? isNotNull(schema.files.trashedAt)
    : isNull(schema.files.trashedAt);

  const baseWhere = and(eq(schema.files.libraryId, id), trashFilter);

  const sortExpr = sql`coalesce(${schema.files.originalCreatedAt}, ${schema.files.createdAt})`;

  // Decode cursor if provided
  let cursorWhere;
  if (query.cursor) {
    try {
      const decoded = JSON.parse(atob(query.cursor as string));
      const { sortValue, id: cursorId } = decoded;
      // (sortValue, id) < (cursorSortValue, cursorId) for DESC ordering
      cursorWhere = or(
        lt(sortExpr, sql`${sortValue}::timestamptz`),
        and(sql`${sortExpr} = ${sortValue}::timestamptz`, lt(schema.files.id, cursorId)),
      );
    } catch {
      throw createError({ statusCode: 400, statusMessage: "Invalid cursor" });
    }
  }

  const where = cursorWhere ? and(baseWhere, cursorWhere) : baseWhere;

  // Run count and data queries in parallel
  const [countResult, rows] = await Promise.all([
    db.select({ value: count() }).from(schema.files).where(baseWhere),
    db
      .select()
      .from(schema.files)
      .where(where)
      .orderBy(desc(sortExpr), desc(schema.files.id))
      .limit(limit + 1),
  ]);

  const totalCount = countResult[0]?.value ?? 0;
  const hasMore = rows.length > limit;
  const files = hasMore ? rows.slice(0, limit) : rows;
  const fileIds = files.map((file) => file.id);

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

  const tagsByFileId = new Map<string, PaginatedFiles["files"][number]["tags"]>();
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

  let nextCursor: string | null = null;
  if (hasMore) {
    const lastFile = files[files.length - 1]!;
    const sortValue = lastFile.originalCreatedAt ?? lastFile.createdAt;
    nextCursor = btoa(JSON.stringify({ sortValue, id: lastFile.id }));
  }

  return {
    files: files.map((f) => ({
      ...f,
      originalCreatedAt: f.originalCreatedAt ? f.originalCreatedAt.toISOString() : null,
      trashedAt: f.trashedAt ? f.trashedAt.toISOString() : null,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      tags: (tagsByFileId.get(f.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    })),
    nextCursor,
    totalCount,
  };
});
