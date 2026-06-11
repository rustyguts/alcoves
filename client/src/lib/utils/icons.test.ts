import { describe, it, expect } from 'vitest';
import lineicons from '@iconify-json/lineicons/icons.json';
import { ICONS } from './icons';

const installed = new Set<string>([
	...Object.keys(lineicons.icons),
	...Object.keys((lineicons as { aliases?: Record<string, unknown> }).aliases ?? {})
]);

describe('ICONS registry', () => {
	it('every value is a lineicons reference whose glyph exists in the installed set', () => {
		for (const [key, value] of Object.entries(ICONS)) {
			expect(value, `${key} must be a lineicons: reference`).toMatch(/^lineicons:[a-z0-9-]+$/);
			const glyph = value.slice('lineicons:'.length);
			expect(installed.has(glyph), `${key} → ${value} not found in @iconify-json/lineicons`).toBe(
				true
			);
		}
	});

	it('keeps the stable semantic keys (spot checks)', () => {
		expect(ICONS.close).toBe('lineicons:xmark');
		expect(ICONS.search).toBe('lineicons:search');
		expect(ICONS.trash).toBe('lineicons:trash-can');
		expect(ICONS.bell).toBe('lineicons:bell-1');
		expect(Object.keys(ICONS).length).toBeGreaterThanOrEqual(80);
	});
});
