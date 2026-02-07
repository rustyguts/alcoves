export const TAG_COLOR_PALETTE = [
  "#EF4444",
  "#F87171",
  "#F97316",
  "#FB923C",
  "#F59E0B",
  "#FBBF24",
  "#EAB308",
  "#FACC15",
  "#84CC16",
  "#A3E635",
  "#22C55E",
  "#4ADE80",
  "#10B981",
  "#34D399",
  "#14B8A6",
  "#2DD4BF",
  "#06B6D4",
  "#22D3EE",
  "#0EA5E9",
  "#38BDF8",
  "#3B82F6",
  "#60A5FA",
  "#6366F1",
  "#818CF8",
  "#8B5CF6",
  "#A78BFA",
  "#A855F7",
  "#C084FC",
  "#D946EF",
  "#E879F9",
  "#EC4899",
  "#F472B6",
] as const;

const TAG_COLOR_SET = new Set<string>(TAG_COLOR_PALETTE);

export function isTagColorInPalette(color: string): boolean {
  return TAG_COLOR_SET.has(color.trim().toUpperCase());
}
