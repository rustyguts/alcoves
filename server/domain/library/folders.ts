import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import type { FolderBreadcrumb } from "~~/server/utils/types";

export function normalizeFolderId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value === "null") return null;
  return value;
}

export async function getFolderRecord(libraryId: string, folderId: string, includeTrashed = false) {
  const [folder] = await db
    .select({
      id: schema.folders.id,
      parentFolderId: schema.folders.parentFolderId,
      name: schema.folders.name,
      trashedAt: schema.folders.trashedAt,
    })
    .from(schema.folders)
    .where(
      and(
        eq(schema.folders.id, folderId),
        eq(schema.folders.libraryId, libraryId),
        includeTrashed ? undefined : isNull(schema.folders.trashedAt),
      ),
    )
    .limit(1);
  return folder ?? null;
}

export async function assertFolderInLibrary(
  libraryId: string,
  folderId: string,
  includeTrashed = false,
) {
  const folder = await getFolderRecord(libraryId, folderId, includeTrashed);
  if (!folder) {
    throw createError({ statusCode: 404, statusMessage: "Folder not found" });
  }
  return folder;
}

export async function getFolderBreadcrumbs(
  libraryId: string,
  folderId: string | null,
): Promise<FolderBreadcrumb[]> {
  if (!folderId) return [];

  const breadcrumbs: FolderBreadcrumb[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw createError({ statusCode: 400, statusMessage: "Invalid folder hierarchy" });
    }
    visited.add(currentId);

    const folder = await getFolderRecord(libraryId, currentId);
    if (!folder) {
      throw createError({ statusCode: 404, statusMessage: "Folder not found" });
    }

    breadcrumbs.push({ id: folder.id, name: folder.name });
    currentId = folder.parentFolderId;
  }

  return breadcrumbs.reverse();
}

export async function assertMoveParentValid(
  libraryId: string,
  folderId: string,
  parentFolderId: string | null,
) {
  if (!parentFolderId) return;
  if (parentFolderId === folderId) {
    throw createError({ statusCode: 400, statusMessage: "Folder cannot be moved into itself" });
  }

  const visited = new Set<string>();
  let currentId: string | null = parentFolderId;

  while (currentId) {
    if (visited.has(currentId)) {
      throw createError({ statusCode: 400, statusMessage: "Invalid folder hierarchy" });
    }
    visited.add(currentId);

    if (currentId === folderId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Folder cannot be moved into a descendant folder",
      });
    }

    const folder = await getFolderRecord(libraryId, currentId);
    if (!folder) {
      throw createError({ statusCode: 404, statusMessage: "Destination folder not found" });
    }

    currentId = folder.parentFolderId;
  }
}

export async function getDescendantFolderIds(
  libraryId: string,
  rootFolderId: string,
  includeTrashed = false,
): Promise<string[]> {
  const descendants: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [rootFolderId];

  while (queue.length) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const children = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.libraryId, libraryId),
          eq(schema.folders.parentFolderId, currentId),
          includeTrashed ? undefined : isNull(schema.folders.trashedAt),
        ),
      );

    for (const child of children) {
      descendants.push(child.id);
      queue.push(child.id);
    }
  }

  return descendants;
}
