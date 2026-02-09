import { and, eq } from "drizzle-orm";
import { isTagColorInPalette, TAG_COLOR_PALETTE } from "~~/shared/tag-colors";
import { db, schema } from "~~/server/database";

const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeHexColor(color: string): string {
  const normalized = color.trim().toUpperCase();
  if (!HEX_COLOR_REGEX.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: "Color must be a 6-digit hex value" });
  }
  if (!isTagColorInPalette(normalized)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Color must be one of the predefined tag colors",
    });
  }
  return normalized;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function getNextUniqueTagColor(libraryId: string): Promise<string> {
  const existing = await db
    .select({ color: schema.tags.color })
    .from(schema.tags)
    .where(eq(schema.tags.libraryId, libraryId));

  const used = new Set(existing.map((tag) => tag.color.toUpperCase()));
  const fromPalette = TAG_COLOR_PALETTE.find((color) => !used.has(color));
  if (fromPalette) return fromPalette;

  throw createError({
    statusCode: 409,
    statusMessage: "All predefined tag colors are currently in use",
  });
}

export async function ensureTagBelongsToLibrary(tagId: string, libraryId: string): Promise<void> {
  const [tag] = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(and(eq(schema.tags.id, tagId), eq(schema.tags.libraryId, libraryId)))
    .limit(1);

  if (!tag) {
    throw createError({ statusCode: 404, statusMessage: "Tag not found" });
  }
}
