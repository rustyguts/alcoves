import { describe, it, expect, vi } from 'vitest';

// Node project: no localStorage. The store must fall back to in-memory state
// when no storage is injected, so pin `browser` to false (SSR-like).
vi.mock('$app/environment', () => ({ browser: false }));

import {
	createEditorPreferences,
	INSPECTOR_DEFAULT_WIDTH,
	INSPECTOR_MAX_WIDTH,
	INSPECTOR_MIN_WIDTH
} from './editor-preferences.svelte';

const KEY = 'alcoves.editor.prefs.v1';

function makeStorage(initial?: Record<string, string>) {
	const map = new Map<string, string>(Object.entries(initial ?? {}));
	const getItem = vi.fn((key: string) => map.get(key) ?? null);
	const setItem = vi.fn((key: string, value: string) => {
		map.set(key, value);
	});
	return { map, getItem, setItem };
}

function stored(storage: ReturnType<typeof makeStorage>): Record<string, unknown> {
	const raw = storage.map.get(KEY);
	expect(raw).toBeTruthy();
	return JSON.parse(raw as string) as Record<string, unknown>;
}

describe('createEditorPreferences — initial load', () => {
	it('uses defaults when storage is empty', () => {
		const storage = makeStorage();
		const prefs = createEditorPreferences(storage);
		expect(storage.getItem).toHaveBeenCalledWith(KEY);
		expect(prefs.inspectorTab).toBe('moments');
		expect(prefs.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
		expect(prefs.snapping).toBe(true);
	});

	it('falls back to defaults on corrupt JSON', () => {
		const prefs = createEditorPreferences(makeStorage({ [KEY]: '{nope' }));
		expect(prefs.inspectorTab).toBe('moments');
		expect(prefs.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
		expect(prefs.snapping).toBe(true);
	});

	it.each(['"hello"', '42', 'null', 'true'])('ignores non-object stored JSON %s', (raw) => {
		const prefs = createEditorPreferences(makeStorage({ [KEY]: raw }));
		expect(prefs.inspectorTab).toBe('moments');
		expect(prefs.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
		expect(prefs.snapping).toBe(true);
	});

	it('falls back to defaults when getItem throws', () => {
		const storage = {
			getItem: vi.fn(() => {
				throw new Error('denied');
			}),
			setItem: vi.fn()
		};
		const prefs = createEditorPreferences(storage);
		expect(prefs.inspectorTab).toBe('moments');
		expect(prefs.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
		expect(prefs.snapping).toBe(true);
	});

	it('restores a stored valid tab', () => {
		const prefs = createEditorPreferences(
			makeStorage({ [KEY]: JSON.stringify({ inspectorTab: 'highlights' }) })
		);
		expect(prefs.inspectorTab).toBe('highlights');
	});

	it('rejects an unknown stored tab', () => {
		const prefs = createEditorPreferences(
			makeStorage({ [KEY]: JSON.stringify({ inspectorTab: 'bogus' }) })
		);
		expect(prefs.inspectorTab).toBe('moments');
	});

	it('keeps defaults for fields missing from a partial record', () => {
		const prefs = createEditorPreferences(
			makeStorage({ [KEY]: JSON.stringify({ snapping: false }) })
		);
		expect(prefs.snapping).toBe(false);
		expect(prefs.inspectorTab).toBe('moments');
		expect(prefs.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
	});

	it.each([
		[100, INSPECTOR_MIN_WIDTH],
		[10000, INSPECTOR_MAX_WIDTH],
		[412.4, 412],
		[412.6, 413],
		['420', 420],
		['abc', INSPECTOR_DEFAULT_WIDTH],
		[null, INSPECTOR_MIN_WIDTH] // Number(null) === 0 → clamped up, not defaulted
	])('clamps/coerces a stored width of %j to %i', (value, expected) => {
		const prefs = createEditorPreferences(
			makeStorage({ [KEY]: JSON.stringify({ inspectorWidth: value }) })
		);
		expect(prefs.inspectorWidth).toBe(expected);
	});
});

describe('createEditorPreferences — setters persist', () => {
	it('setInspectorTab updates state and writes the full record', () => {
		const storage = makeStorage();
		const prefs = createEditorPreferences(storage);
		prefs.setInspectorTab('audio');
		expect(prefs.inspectorTab).toBe('audio');
		expect(storage.setItem).toHaveBeenCalledTimes(1);
		expect(stored(storage)).toEqual({
			inspectorTab: 'audio',
			inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
			snapping: true
		});
	});

	it.each([
		[250, INSPECTOR_MIN_WIDTH],
		[700, INSPECTOR_MAX_WIDTH],
		[INSPECTOR_MIN_WIDTH, INSPECTOR_MIN_WIDTH],
		[INSPECTOR_MAX_WIDTH, INSPECTOR_MAX_WIDTH],
		[412.6, 413],
		[Number.NaN, INSPECTOR_DEFAULT_WIDTH],
		[Number.POSITIVE_INFINITY, INSPECTOR_DEFAULT_WIDTH]
	])('setInspectorWidth(%d) clamps/rounds to %d and persists', (input, expected) => {
		const storage = makeStorage();
		const prefs = createEditorPreferences(storage);
		prefs.setInspectorWidth(input);
		expect(prefs.inspectorWidth).toBe(expected);
		expect(stored(storage).inspectorWidth).toBe(expected);
	});

	it('setSnapping persists the explicit value', () => {
		const storage = makeStorage();
		const prefs = createEditorPreferences(storage);
		prefs.setSnapping(false);
		expect(prefs.snapping).toBe(false);
		expect(stored(storage).snapping).toBe(false);
		prefs.setSnapping(true);
		expect(prefs.snapping).toBe(true);
		expect(stored(storage).snapping).toBe(true);
	});

	it('toggleSnapping flips and persists on every call', () => {
		const storage = makeStorage();
		const prefs = createEditorPreferences(storage);
		prefs.toggleSnapping();
		expect(prefs.snapping).toBe(false);
		expect(stored(storage).snapping).toBe(false);
		prefs.toggleSnapping();
		expect(prefs.snapping).toBe(true);
		expect(stored(storage).snapping).toBe(true);
		expect(storage.setItem).toHaveBeenCalledTimes(2);
	});

	it('round-trips through a fresh store over the same storage', () => {
		const storage = makeStorage();
		const first = createEditorPreferences(storage);
		first.setInspectorTab('transcript');
		first.setInspectorWidth(444);
		first.setSnapping(false);

		const second = createEditorPreferences(storage);
		expect(second.inspectorTab).toBe('transcript');
		expect(second.inspectorWidth).toBe(444);
		expect(second.snapping).toBe(false);
	});

	it('survives setItem throwing (private mode / quota) — state still updates', () => {
		const storage = {
			getItem: vi.fn(() => null),
			setItem: vi.fn(() => {
				throw new Error('quota exceeded');
			})
		};
		const prefs = createEditorPreferences(storage);
		expect(() => {
			prefs.setInspectorTab('highlights');
			prefs.setInspectorWidth(400);
			prefs.toggleSnapping();
		}).not.toThrow();
		expect(prefs.inspectorTab).toBe('highlights');
		expect(prefs.inspectorWidth).toBe(400);
		expect(prefs.snapping).toBe(false);
	});
});

describe('createEditorPreferences — no storage (SSR / node)', () => {
	it('starts with defaults when no storage is injected and browser is false', () => {
		const prefs = createEditorPreferences();
		expect(prefs.inspectorTab).toBe('moments');
		expect(prefs.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
		expect(prefs.snapping).toBe(true);
	});

	it('setters still work in-memory without storage', () => {
		const prefs = createEditorPreferences();
		expect(() => {
			prefs.setInspectorTab('audio');
			prefs.setInspectorWidth(9999);
			prefs.toggleSnapping();
		}).not.toThrow();
		expect(prefs.inspectorTab).toBe('audio');
		expect(prefs.inspectorWidth).toBe(INSPECTOR_MAX_WIDTH);
		expect(prefs.snapping).toBe(false);
	});
});
