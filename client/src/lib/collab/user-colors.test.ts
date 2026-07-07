import { describe, expect, it } from 'vitest';
import { userColor } from './user-colors';

describe('userColor', () => {
	it('is deterministic for the same user id', () => {
		const id = 'b2a7c9f0-1234-5678-9abc-def012345678';
		expect(userColor(id)).toEqual(userColor(id));
	});

	it('returns a well-formed color pair', () => {
		const { color, colorLight } = userColor('some-user');
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
		expect(colorLight).toMatch(/^#[0-9a-f]{8}$/);
		expect(colorLight.startsWith(color)).toBe(true);
	});

	it('spreads distinct users across the palette', () => {
		const colors = new Set<string>();
		for (let i = 0; i < 50; i++) colors.add(userColor(`user-${i}`).color);
		// Not a strict uniformity test — just that hashing isn't collapsing.
		expect(colors.size).toBeGreaterThan(4);
	});
});
