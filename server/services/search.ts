import { and, asc, count, desc, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import type { GlobalSearchResponse, GlobalSearchResult } from "~~/shared/types/api";

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 120;

interface SearchItem {
  id: string;
  libraryId: string;
  libraryName: string;
  parentFolderId: string | null;
  name: string;
  kind: "file" | "folder";
  mimeType: string | null;
  size: number | null;
  updatedAt: Date;
  rank: number;
}

interface FolderIndexRow {
  id: string;
  parentFolderId: string | null;
  name: string;
}

function parseLimit(input: unknown): number {
  if (typeof input !== "string") return DEFAULT_LIMIT;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function getMatchRank(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(` ${query}`) || name.includes(`-${query}`) || name.includes(`_${query}`))
    return 2;
  return 3;
}

function buildFolderPath(
  folderId: string | null,
  foldersById: Map<string, FolderIndexRow>,
  cache: Map<string | null, string>,
): string {
  if (cache.has(folderId)) {
    return cache.get(folderId)!;
  }
  if (!folderId) {
    cache.set(folderId, "/");
    return "/";
  }

  const visited = new Set<string>();
  const segments: string[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const folder = foldersById.get(currentId);
    if (!folder) break;
    segments.unshift(folder.name);
    currentId = folder.parentFolderId;
  }

  const path = segments.length ? `/${segments.join("/")}` : "/";
  cache.set(folderId, path);
  return path;
}

export async function searchGlobalForUser(
  userId: string,
  options: { q?: unknown; limit?: unknown },
): Promise<GlobalSearchResponse> {
  const searchTerm = typeof options.q === "string" ? options.q.trim() : "";
  const limit = parseLimit(options.limit);

  if (searchTerm.length < MIN_QUERY_LENGTH) {
    return {
      query: searchTerm,
      totalCount: 0,
      results: [],
    };
  }

  const accessibleLibraries = await db
    .select({
      id: schema.libraries.id,
      name: schema.libraries.name,
    })
    .from(schema.libraries)
    .where(
      or(
        eq(schema.libraries.ownerId, userId),
        and(
          eq(schema.libraries.isDefault, false),
          exists(
            db
              .select({ id: schema.libraryMembers.id })
              .from(schema.libraryMembers)
              .where(
                and(
                  eq(schema.libraryMembers.libraryId, schema.libraries.id),
                  eq(schema.libraryMembers.userId, userId),
                ),
              ),
          ),
        ),
      ),
    );

  if (!accessibleLibraries.length) {
    return {
      query: searchTerm,
      totalCount: 0,
      results: [],
    };
  }

  const libraryIds = accessibleLibraries.map((library) => library.id);
  const likeTerm = `%${searchTerm}%`;

  const folderWhere = and(
    inArray(schema.folders.libraryId, libraryIds),
    isNull(schema.folders.trashedAt),
    ilike(schema.folders.name, likeTerm),
  );

  const fileWhere = and(
    inArray(schema.files.libraryId, libraryIds),
    isNull(schema.files.trashedAt),
    ilike(schema.files.name, likeTerm),
  );

  const [folderCountResult, fileCountResult, folderRows, fileRows] = await Promise.all([
    db.select({ value: count() }).from(schema.folders).where(folderWhere),
    db.select({ value: count() }).from(schema.files).where(fileWhere),
    db
      .select({
        id: schema.folders.id,
        libraryId: schema.folders.libraryId,
        libraryName: schema.libraries.name,
        parentFolderId: schema.folders.parentFolderId,
        name: schema.folders.name,
        updatedAt: schema.folders.updatedAt,
      })
      .from(schema.folders)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.folders.libraryId))
      .where(folderWhere)
      .orderBy(asc(sql<string>`lower(${schema.folders.name})`), desc(schema.folders.updatedAt))
      .limit(limit),
    db
      .select({
        id: schema.files.id,
        libraryId: schema.files.libraryId,
        libraryName: schema.libraries.name,
        parentFolderId: schema.files.parentFolderId,
        name: schema.files.name,
        mimeType: schema.files.mimeType,
        size: schema.files.size,
        updatedAt: schema.files.updatedAt,
      })
      .from(schema.files)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.files.libraryId))
      .where(fileWhere)
      .orderBy(asc(sql<string>`lower(${schema.files.name})`), desc(schema.files.updatedAt))
      .limit(limit),
  ]);

  const normalizedQuery = searchTerm.toLowerCase();
  const ranked: SearchItem[] = [
    ...folderRows.map((row) => ({
      id: row.id,
      libraryId: row.libraryId,
      libraryName: row.libraryName,
      parentFolderId: row.parentFolderId,
      name: row.name,
      kind: "folder" as const,
      mimeType: null,
      size: null,
      updatedAt: row.updatedAt,
      rank: getMatchRank(row.name.toLowerCase(), normalizedQuery),
    })),
    ...fileRows.map((row) => ({
      id: row.id,
      libraryId: row.libraryId,
      libraryName: row.libraryName,
      parentFolderId: row.parentFolderId,
      name: row.name,
      kind: "file" as const,
      mimeType: row.mimeType,
      size: row.size,
      updatedAt: row.updatedAt,
      rank: getMatchRank(row.name.toLowerCase(), normalizedQuery),
    })),
  ];

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    if (a.libraryName !== b.libraryName) return a.libraryName.localeCompare(b.libraryName);
    if (a.updatedAt.getTime() !== b.updatedAt.getTime()) {
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
    return a.name.localeCompare(b.name);
  });

  const topResults = ranked.slice(0, limit);
  const resultLibraryIds = Array.from(new Set(topResults.map((result) => result.libraryId)));
  const pathIndexRows = resultLibraryIds.length
    ? await db
        .select({
          id: schema.folders.id,
          parentFolderId: schema.folders.parentFolderId,
          name: schema.folders.name,
        })
        .from(schema.folders)
        .where(
          and(
            inArray(schema.folders.libraryId, resultLibraryIds),
            isNull(schema.folders.trashedAt),
          ),
        )
    : [];

  const foldersById = new Map<string, FolderIndexRow>();
  for (const folder of pathIndexRows) {
    foldersById.set(folder.id, folder);
  }
  const pathCache = new Map<string | null, string>();

  const results: GlobalSearchResult[] = topResults.map((item) => {
    const targetFolderId = item.kind === "folder" ? item.id : item.parentFolderId;
    const locationPath = buildFolderPath(targetFolderId, foldersById, pathCache);

    return {
      id: item.id,
      libraryId: item.libraryId,
      libraryName: item.libraryName,
      parentFolderId: item.parentFolderId,
      targetFolderId,
      name: item.name,
      kind: item.kind,
      locationPath,
      mimeType: item.mimeType ?? undefined,
      size: item.size ?? undefined,
      updatedAt: item.updatedAt.toISOString(),
    };
  });

  return {
    query: searchTerm,
    totalCount: (folderCountResult[0]?.value ?? 0) + (fileCountResult[0]?.value ?? 0),
    results,
  };
}
