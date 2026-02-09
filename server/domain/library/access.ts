import type { H3Event } from "h3";
import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export type LibraryAccessRole = "owner" | "admin" | "viewer";

export interface LibraryAccess {
  libraryId: string;
  libraryName: string;
  ownerId: string;
  isDefault: boolean;
  role: LibraryAccessRole;
  isOwner: boolean;
  isAdmin: boolean;
}

export async function getLibraryAccess(
  userId: string,
  libraryId: string,
): Promise<LibraryAccess | null> {
  const [library] = await db
    .select({
      id: schema.libraries.id,
      name: schema.libraries.name,
      ownerId: schema.libraries.ownerId,
      isDefault: schema.libraries.isDefault,
    })
    .from(schema.libraries)
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!library) return null;

  if (library.ownerId === userId) {
    return {
      libraryId: library.id,
      libraryName: library.name,
      ownerId: library.ownerId,
      isDefault: library.isDefault,
      role: "owner",
      isOwner: true,
      isAdmin: true,
    };
  }

  // Default/personal libraries are never collaborative.
  if (library.isDefault) return null;

  const [membership] = await db
    .select({ role: schema.libraryMembers.role })
    .from(schema.libraryMembers)
    .where(
      and(
        eq(schema.libraryMembers.libraryId, library.id),
        eq(schema.libraryMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) return null;

  return {
    libraryId: library.id,
    libraryName: library.name,
    ownerId: library.ownerId,
    isDefault: library.isDefault,
    role: membership.role,
    isOwner: false,
    isAdmin: membership.role === "admin",
  };
}

export async function requireLibraryAccess(
  event: H3Event,
  libraryId: string,
): Promise<LibraryAccess> {
  const cachedAccess = (event.context as { libraryAccess?: LibraryAccess }).libraryAccess;
  if (cachedAccess?.libraryId === libraryId) {
    return cachedAccess;
  }

  const userId = event.context.userId as string | undefined;
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  const access = await getLibraryAccess(userId, libraryId);
  if (!access) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  (event.context as { libraryAccess?: LibraryAccess }).libraryAccess = access;
  return access;
}

export async function requireLibraryAdmin(
  event: H3Event,
  libraryId: string,
): Promise<LibraryAccess> {
  const access = await requireLibraryAccess(event, libraryId);
  if (!access.isAdmin) {
    throw createError({
      statusCode: 403,
      statusMessage: "Only library admins can perform this action",
    });
  }

  return access;
}

export async function requireCollaborativeLibraryAdmin(
  event: H3Event,
  libraryId: string,
): Promise<LibraryAccess> {
  const access = await requireLibraryAdmin(event, libraryId);
  if (access.isDefault) {
    throw createError({
      statusCode: 400,
      statusMessage: "Collaboration is disabled for personal libraries",
    });
  }

  return access;
}
