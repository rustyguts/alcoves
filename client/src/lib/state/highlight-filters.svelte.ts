import { api } from '$lib/api';
import type { HighlightFilter, HighlightFilterCreate, HighlightFilterPatch } from '$lib/types/api';

/**
 * Built-in highlight-filter presets a user can one-click seed into a library.
 * Ported verbatim from the Nuxt `useHighlightFilters` composable.
 */
export const HIGHLIGHT_PRESETS: HighlightFilterCreate[] = [
	{ name: 'Laughter', expression: 'laughter:25, giggle, snicker', color: '#22C55E' },
	{ name: 'Screaming', expression: 'screaming:30, yell, shout', color: '#E11D48' },
	{ name: 'Cheering', expression: 'cheering:25, applause, whoop', color: '#EAB308' },
	{ name: 'Gunshot', expression: 'gunshot:30, machine gun:30', color: '#6B7280' },
	{ name: 'Profanity', expression: 'word:shit, word:fuck, word:damn, word:hell', color: '#8B5CF6' },
	{ name: 'Reactions', expression: 'word:wtf, word:bro, word:dude, word:bruh', color: '#06B6D4' },
	{
		name: 'Funny clip',
		expression: 'laughter:25 & word:bro, screaming:30 & word:wtf',
		color: '#F97316'
	}
];

/**
 * Highlight-filter CRUD + preset seeding for a single library.
 *
 * `getLibraryId` is a getter so the store tracks a reactive library id from the
 * consuming component (the Vue version took a `Ref<string>`). State is exposed
 * via getters so reactivity survives the function boundary; the component calls
 * `refresh()` from its own `onMount`/`$effect`.
 */
export function createHighlightFilters(getLibraryId: () => string) {
	let filters = $state<HighlightFilter[]>([]);
	let loading = $state(false);
	let error = $state<unknown>(null);

	async function refresh() {
		const libraryId = getLibraryId();
		if (!libraryId) return;
		loading = true;
		error = null;
		try {
			filters = (await api.highlightFilters.list(libraryId)) ?? [];
		} catch (err) {
			error = err;
		} finally {
			loading = false;
		}
	}

	async function create(body: HighlightFilterCreate): Promise<HighlightFilter> {
		const created = await api.highlightFilters.create(getLibraryId(), body);
		filters = [...filters, created];
		return created;
	}

	async function update(filterId: string, body: HighlightFilterPatch): Promise<HighlightFilter> {
		const updated = await api.highlightFilters.update(getLibraryId(), filterId, body);
		filters = filters.map((f) => (f.id === filterId ? updated : f));
		return updated;
	}

	async function remove(filterId: string): Promise<void> {
		await api.highlightFilters.remove(getLibraryId(), filterId);
		filters = filters.filter((f) => f.id !== filterId);
	}

	async function loadPresets(): Promise<void> {
		for (const preset of HIGHLIGHT_PRESETS) {
			try {
				await create(preset);
			} catch {
				/* ignore individual preset failures */
			}
		}
	}

	return {
		get filters() {
			return filters;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		refresh,
		create,
		update,
		remove,
		loadPresets
	};
}
