// One Dark Pro accent swatches (uppercase — `isTagColorInPalette` compares
// against the uppercased input).
export const TAG_COLOR_PALETTE = [
  "#E06C75",
  "#E8946A",
  "#D19A66",
  "#E5C07B",
  "#B3C76B",
  "#98C379",
  "#56B6C2",
  "#61AFEF",
  "#528BFF",
  "#8A7FE8",
  "#C678DD",
  "#E06C9E",
] as const;

const TAG_COLOR_SET = new Set<string>(TAG_COLOR_PALETTE);

export function isTagColorInPalette(color: string): boolean {
  return TAG_COLOR_SET.has(color.trim().toUpperCase());
}
