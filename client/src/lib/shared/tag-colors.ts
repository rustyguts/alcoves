export const TAG_COLOR_PALETTE = [
	'#E11D48',
	'#F97316',
	'#F59E0B',
	'#EAB308',
	'#84CC16',
	'#22C55E',
	'#14B8A6',
	'#06B6D4',
	'#3B82F6',
	'#6366F1',
	'#8B5CF6',
	'#D946EF'
] as const;

const TAG_COLOR_SET = new Set<string>(TAG_COLOR_PALETTE);

export function isTagColorInPalette(color: string): boolean {
	return TAG_COLOR_SET.has(color.trim().toUpperCase());
}
