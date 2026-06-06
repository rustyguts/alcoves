import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { theme } from './theme.svelte';

// Runs in the browser project (needs real document/localStorage/matchMedia).
// Reset the shared singleton + DOM/storage to a clean default before each test.
beforeEach(() => {
	theme.systemPrefersDark = false;
	theme.preference = 'system';
	localStorage.clear();
	document.documentElement.classList.remove('dark');
});

describe('theme store', () => {
	it('applies and persists an explicit dark/light preference', () => {
		theme.set('dark');
		expect(theme.preference).toBe('dark');
		expect(theme.resolved).toBe('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(localStorage.getItem('alcoves.theme')).toBe('dark');

		theme.set('light');
		expect(theme.resolved).toBe('light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
		expect(localStorage.getItem('alcoves.theme')).toBe('light');
	});

	it('resolves "system" against the OS preference', () => {
		theme.systemPrefersDark = true;
		theme.set('system');
		expect(theme.resolved).toBe('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);

		theme.systemPrefersDark = false;
		theme.apply();
		expect(theme.resolved).toBe('light');
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	it('init() reads a stored preference and applies it', () => {
		localStorage.setItem('alcoves.theme', 'dark');
		theme.init();
		expect(theme.preference).toBe('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	describe('init() with a controllable matchMedia', () => {
		const realMatchMedia = window.matchMedia;
		let changeHandler: ((e: { matches: boolean }) => void) | undefined;
		let mqMatches = false;

		beforeEach(() => {
			changeHandler = undefined;
			mqMatches = false;
			window.matchMedia = vi.fn().mockImplementation(() => ({
				get matches() {
					return mqMatches;
				},
				addEventListener: (_type: string, handler: (e: { matches: boolean }) => void) => {
					changeHandler = handler;
				},
				removeEventListener: vi.fn()
			})) as unknown as typeof window.matchMedia;
		});

		afterEach(() => {
			window.matchMedia = realMatchMedia;
		});

		it('seeds systemPrefersDark from the initial media query match', () => {
			mqMatches = true;
			theme.init();
			expect(theme.systemPrefersDark).toBe(true);
			// preference defaults to "system" with nothing stored, so dark resolves.
			expect(theme.preference).toBe('system');
			expect(theme.resolved).toBe('dark');
			expect(document.documentElement.classList.contains('dark')).toBe(true);
		});

		it('reacts to OS scheme changes via the change listener and re-applies', () => {
			theme.init();
			expect(theme.systemPrefersDark).toBe(false);
			expect(document.documentElement.classList.contains('dark')).toBe(false);
			expect(changeHandler).toBeTypeOf('function');

			// OS flips to dark — the listener should update state and apply the class.
			changeHandler?.({ matches: true });
			expect(theme.systemPrefersDark).toBe(true);
			expect(theme.resolved).toBe('dark');
			expect(document.documentElement.classList.contains('dark')).toBe(true);

			// OS flips back to light.
			changeHandler?.({ matches: false });
			expect(theme.systemPrefersDark).toBe(false);
			expect(theme.resolved).toBe('light');
			expect(document.documentElement.classList.contains('dark')).toBe(false);
		});

		it('ignores an invalid stored preference and keeps the default', () => {
			localStorage.setItem('alcoves.theme', 'not-a-theme');
			theme.init();
			expect(theme.preference).toBe('system');
		});

		it('change listener stays scoped to "system": explicit dark wins regardless of OS', () => {
			theme.init();
			theme.set('dark');
			expect(document.documentElement.classList.contains('dark')).toBe(true);

			// OS reports light, but the explicit "dark" preference is unaffected.
			changeHandler?.({ matches: false });
			expect(theme.systemPrefersDark).toBe(false);
			expect(theme.resolved).toBe('dark');
			expect(document.documentElement.classList.contains('dark')).toBe(true);
		});
	});
});
