import { describe, it, expect } from 'vitest';
import { TAG_COLOR_PALETTE, isTagColorInPalette } from './tag-colors';

describe('TAG_COLOR_PALETTE', () => {
	it('has 12 unique uppercase hex colors', () => {
		expect(TAG_COLOR_PALETTE).toHaveLength(12);
		expect(new Set(TAG_COLOR_PALETTE).size).toBe(12);
		for (const c of TAG_COLOR_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/);
	});
});

describe('isTagColorInPalette', () => {
	it('matches palette colors case-insensitively and trimmed', () => {
		expect(isTagColorInPalette('#E11D48')).toBe(true);
		expect(isTagColorInPalette('#e11d48')).toBe(true);
		expect(isTagColorInPalette('  #3b82f6  ')).toBe(true);
	});

	it('rejects colors outside the palette', () => {
		expect(isTagColorInPalette('#000000')).toBe(false);
		expect(isTagColorInPalette('')).toBe(false);
		expect(isTagColorInPalette('red')).toBe(false);
	});
});
