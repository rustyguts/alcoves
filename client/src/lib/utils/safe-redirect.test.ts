import { describe, it, expect } from 'vitest';
import { safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
	it('keeps same-site absolute paths', () => {
		expect(safeRedirect('/profile')).toBe('/profile');
		expect(safeRedirect('/libraries/abc?tab=1')).toBe('/libraries/abc?tab=1');
	});

	it('rejects protocol-relative and backslash off-site forms', () => {
		expect(safeRedirect('//evil.com')).toBe('/');
		expect(safeRedirect('/\\evil.com')).toBe('/');
	});

	it('rejects absolute URLs and non-path values', () => {
		expect(safeRedirect('https://evil.com')).toBe('/');
		expect(safeRedirect('javascript:alert(1)')).toBe('/');
		expect(safeRedirect('profile')).toBe('/');
	});

	it('falls back to / for empty/missing values', () => {
		expect(safeRedirect('')).toBe('/');
		expect(safeRedirect(null)).toBe('/');
		expect(safeRedirect(undefined)).toBe('/');
	});
});
