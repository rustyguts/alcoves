import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

const TAG_COLORS = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#84CC16",
  "#22C55E",
  "#10B981",
  "#14B8A6",
  "#06B6D4",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#F43F5E",
] as const;

const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeHexColor(color: string): string {
  const normalized = color.trim().toUpperCase();
  if (!HEX_COLOR_REGEX.test(normalized)) {
    throw createError({ statusCode: 400, statusMessage: "Color must be a 6-digit hex value" });
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
  const fromPalette = TAG_COLORS.find((color) => !used.has(color));
  if (fromPalette) return fromPalette;

  let attempts = 0;
  while (attempts < 32) {
    attempts += 1;
    const hue = Math.floor(Math.random() * 360);
    const color = hslToHex(hue, 70, 45);
    if (!used.has(color)) return color;
  }

  throw createError({ statusCode: 500, statusMessage: "Failed to generate a unique tag color" });
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

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
