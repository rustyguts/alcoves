import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AudioDetection, HighlightFilter } from '$lib/types/api';

const toastMock = vi.hoisted(() => ({
	add: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}));

// A controllable fake of the underlying highlight-filters store. Its CRUD
// methods are spies so we can force success/failure independently, and
// `filters` is settable so the editor store's match/aggregate derivations have
// data to chew on. The real derivation logic (matches/aggregates/hasSignals)
// lives in editor-highlights itself and is exercised directly.
const filtersState = vi.hoisted(() => ({ filters: [] as HighlightFilter[], loading: false }));
const storeMethods = vi.hoisted(() => ({
	refresh: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	loadPresets: vi.fn()
}));

vi.mock('$lib/state/toast', () => ({ toast: toastMock }));
vi.mock('$lib/state/highlight-filters.svelte', () => ({
	createHighlightFilters: (getLibraryId: () => string) => ({
		get filters() {
			return filtersState.filters;
		},
		get loading() {
			return filtersState.loading;
		},
		get error() {
			return null;
		},
		refresh: (...a: unknown[]) => storeMethods.refresh(getLibraryId(), ...a),
		create: (...a: unknown[]) => storeMethods.create(...a),
		update: (...a: unknown[]) => storeMethods.update(...a),
		remove: (...a: unknown[]) => storeMethods.remove(...a),
		loadPresets: (...a: unknown[]) => storeMethods.loadPresets(...a)
	})
}));

import { createEditorHighlights } from './editor-highlights.svelte';

function makeFilter(over: Partial<HighlightFilter> = {}): HighlightFilter {
	return {
		id: 'f1',
		libraryId: 'lib1',
		createdById: null,
		name: 'Filter',
		expression: '',
		proximitySeconds: 0,
		color: '#fff',
		createdAt: '',
		updatedAt: '',
		...over
	};
}

function makeDetection(over: Partial<AudioDetection> = {}): AudioDetection {
	return {
		id: 'd',
		fileId: 'file1',
		libraryId: 'lib1',
		label: 'laughter',
		classIndex: 0,
		score: 0.5,
		startSeconds: 0,
		endSeconds: 1,
		version: 1,
		createdAt: '',
		...over
	};
}

const VTT = (cue: string) => `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${cue}\n`;

beforeEach(() => {
	vi.clearAllMocks();
	filtersState.filters = [];
	filtersState.loading = false;
});

describe('createEditorHighlights — re-export + refresh', () => {
	it('starts empty and re-exports filters/loading from the underlying store', () => {
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		expect(h.filters).toEqual([]);
		expect(h.loading).toBe(false);
		expect(h.matches).toEqual({});
		expect(h.aggregates).toEqual({});
		expect(h.cues).toEqual([]);
	});

	it('re-exports the underlying filters/loading reactively', () => {
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		filtersState.filters = [makeFilter({ id: 'a' })];
		filtersState.loading = true;
		expect(h.filters).toEqual([makeFilter({ id: 'a' })]);
		expect(h.loading).toBe(true);
	});

	it('refresh() delegates to the underlying store with the current libraryId', async () => {
		const h = createEditorHighlights(
			() => 'lib7',
			() => [],
			() => null
		);
		await h.refresh();
		expect(storeMethods.refresh).toHaveBeenCalledWith('lib7');
	});
});

describe('createEditorHighlights — hasSignals', () => {
	it('is true when there are audio detections', () => {
		const h = createEditorHighlights(
			() => 'lib1',
			() => [makeDetection()],
			() => null
		);
		expect(h.hasSignals).toBe(true);
	});

	it('is true when there is a transcript', () => {
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => 'WEBVTT\n...'
		);
		expect(h.hasSignals).toBe(true);
	});

	it('is false with neither signal', () => {
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		expect(h.hasSignals).toBe(false);
	});

	it('treats an empty-string transcript as no signal', () => {
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => ''
		);
		expect(h.hasSignals).toBe(false);
	});
});

describe('createEditorHighlights — CRUD facade + toasts', () => {
	it('onCreate toasts success and forwards the body', async () => {
		storeMethods.create.mockResolvedValue(makeFilter({ id: 'new' }));
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		await h.onCreate({ name: 'Laughs', expression: 'laughter', color: '#fff' });
		expect(storeMethods.create).toHaveBeenCalledWith({
			name: 'Laughs',
			expression: 'laughter',
			color: '#fff'
		});
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Filter "Laughs" added',
			color: 'success'
		});
	});

	it('onCreate toasts an error on failure', async () => {
		storeMethods.create.mockRejectedValue(new Error('x'));
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		await h.onCreate({ name: 'Laughs', expression: 'laughter', color: '#fff' });
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to add filter', color: 'error' });
	});

	it('onUpdate is silent on success and toasts on failure', async () => {
		storeMethods.update.mockResolvedValue(makeFilter({ id: 'a' }));
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		await h.onUpdate('a', { name: 'n' });
		expect(storeMethods.update).toHaveBeenCalledWith('a', { name: 'n' });
		expect(toastMock.add).not.toHaveBeenCalled();

		storeMethods.update.mockRejectedValue(new Error('x'));
		await h.onUpdate('a', { name: 'n' });
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to update filter',
			color: 'error'
		});
	});

	it('onRemove is silent on success and toasts on failure', async () => {
		storeMethods.remove.mockResolvedValue(undefined);
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		await h.onRemove('a');
		expect(storeMethods.remove).toHaveBeenCalledWith('a');
		expect(toastMock.add).not.toHaveBeenCalled();

		storeMethods.remove.mockRejectedValue(new Error('x'));
		await h.onRemove('a');
		expect(toastMock.add).toHaveBeenCalledWith({
			title: 'Failed to delete filter',
			color: 'error'
		});
	});

	it('onLoadPresets toasts success then error', async () => {
		storeMethods.loadPresets.mockResolvedValue(undefined);
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => null
		);
		await h.onLoadPresets();
		expect(storeMethods.loadPresets).toHaveBeenCalled();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Presets loaded', color: 'success' });

		toastMock.add.mockClear();
		storeMethods.loadPresets.mockRejectedValue(new Error('x'));
		await h.onLoadPresets();
		expect(toastMock.add).toHaveBeenCalledWith({ title: 'Failed to load presets', color: 'error' });
	});
});

describe('createEditorHighlights — matches/aggregates derivation', () => {
	it('produces an empty match list for an empty expression', () => {
		filtersState.filters = [makeFilter({ id: 'f1', expression: '' })];
		const h = createEditorHighlights(
			() => 'lib1',
			() => [makeDetection()],
			() => null
		);
		expect(h.matches.f1).toEqual([]);
		expect(h.aggregates.f1).toEqual({
			count: 0,
			meanScore: 0,
			maxScore: 0,
			expressionErrors: []
		});
	});

	it('matches a single audio term against detections above its threshold', () => {
		filtersState.filters = [makeFilter({ id: 'f1', expression: 'laughter:25' })];
		const detections = [
			makeDetection({ id: 'd1', label: 'Laughter', score: 0.9, startSeconds: 5, endSeconds: 6 }),
			makeDetection({ id: 'd2', label: 'Laughter', score: 0.1, startSeconds: 10, endSeconds: 11 })
		];
		const h = createEditorHighlights(
			() => 'lib1',
			() => detections,
			() => null
		);
		const m = h.matches.f1;
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({
			filterId: 'f1',
			startSeconds: 5,
			endSeconds: 6,
			score: 0.9,
			evidence: ['Laughter']
		});
		expect(h.aggregates.f1).toMatchObject({ count: 1, meanScore: 0.9, maxScore: 0.9 });
	});

	it('matches a word term against transcript cues', () => {
		filtersState.filters = [makeFilter({ id: 'f1', expression: 'word:hello' })];
		const h = createEditorHighlights(
			() => 'lib1',
			() => [],
			() => VTT('well hello there')
		);
		expect(h.cues).toHaveLength(1);
		const m = h.matches.f1;
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({ score: 1, evidence: ['well hello there'] });
	});

	it('requires AND terms to co-occur within the proximity window', () => {
		filtersState.filters = [
			makeFilter({ id: 'f1', expression: 'laughter:25 & word:bro', proximitySeconds: 2 })
		];
		const detections = [
			makeDetection({ id: 'd1', label: 'laughter', score: 0.8, startSeconds: 0, endSeconds: 2 })
		];
		const h = createEditorHighlights(
			() => 'lib1',
			() => detections,
			() => 'WEBVTT\n\n00:00:00.500 --> 00:00:01.500\nyo bro\n'
		);
		const m = h.matches.f1;
		expect(m).toHaveLength(1);
		expect(m[0]!.evidence).toContain('laughter');
		expect(m[0]!.evidence).toContain('yo bro');
		expect(m[0]!.startSeconds).toBe(0);
		expect(m[0]!.endSeconds).toBe(2);
	});

	it('drops an AND group when a partner term is out of proximity range', () => {
		filtersState.filters = [
			makeFilter({ id: 'f1', expression: 'laughter:25 & word:bro', proximitySeconds: 1 })
		];
		const detections = [
			makeDetection({ id: 'd1', label: 'laughter', score: 0.8, startSeconds: 0, endSeconds: 1 })
		];
		const h = createEditorHighlights(
			() => 'lib1',
			() => detections,
			() => 'WEBVTT\n\n00:00:20.000 --> 00:00:21.000\nyo bro\n'
		);
		expect(h.matches.f1).toEqual([]);
	});

	it('surfaces parser errors in aggregates', () => {
		filtersState.filters = [makeFilter({ id: 'f1', expression: 'laughter & : :' })];
		const h = createEditorHighlights(
			() => 'lib1',
			() => [makeDetection({ label: 'laughter', score: 0.9 })],
			() => null
		);
		expect(h.aggregates.f1!.expressionErrors.length).toBeGreaterThan(0);
	});

	it('OR-joins groups and de-dups identical matches across groups', () => {
		filtersState.filters = [makeFilter({ id: 'f1', expression: 'laughter, laughter' })];
		const detections = [
			makeDetection({ id: 'd1', label: 'laughter', score: 0.7, startSeconds: 3, endSeconds: 4 })
		];
		const h = createEditorHighlights(
			() => 'lib1',
			() => detections,
			() => null
		);
		expect(h.matches.f1).toHaveLength(1);
	});

	it('recomputes derivations when the input getters change', () => {
		filtersState.filters = [makeFilter({ id: 'f1', expression: 'laughter:25' })];
		let detections: AudioDetection[] = [];
		const h = createEditorHighlights(
			() => 'lib1',
			() => detections,
			() => null
		);
		expect(h.matches.f1).toEqual([]);
		detections = [makeDetection({ label: 'laughter', score: 0.9 })];
		expect(h.matches.f1).toHaveLength(1);
	});

	it('handles multiple filters independently', () => {
		filtersState.filters = [
			makeFilter({ id: 'f1', expression: 'laughter:25' }),
			makeFilter({ id: 'f2', expression: 'word:bye' })
		];
		const h = createEditorHighlights(
			() => 'lib1',
			() => [makeDetection({ label: 'laughter', score: 0.9 })],
			() => VTT('goodbye now')
		);
		expect(h.matches.f1).toHaveLength(1);
		expect(h.matches.f2).toHaveLength(1);
		expect(h.aggregates.f1!.count).toBe(1);
		expect(h.aggregates.f2!.count).toBe(1);
	});
});
