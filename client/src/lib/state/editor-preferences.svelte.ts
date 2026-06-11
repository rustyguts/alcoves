import { browser } from '$app/environment';

/**
 * Editor UI preferences — the user-customizable bits of the editor workspace
 * (active inspector tab, inspector width, snapping), persisted to localStorage
 * so the layout survives reloads.
 *
 * Storage is injectable so the store stays unit-testable in the node project;
 * the default only touches localStorage behind the `browser` guard (SSR safe).
 */

export type InspectorTab = 'moments' | 'transcript' | 'highlights' | 'audio';

export const INSPECTOR_TABS: InspectorTab[] = ['moments', 'transcript', 'highlights', 'audio'];
export const INSPECTOR_MIN_WIDTH = 300;
export const INSPECTOR_MAX_WIDTH = 560;
export const INSPECTOR_DEFAULT_WIDTH = 440;

const STORAGE_KEY = 'alcoves.editor.prefs.v1';

export type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface StoredPrefs {
	inspectorTab?: unknown;
	inspectorWidth?: unknown;
	snapping?: unknown;
}

function clampWidth(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return INSPECTOR_DEFAULT_WIDTH;
	return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(n)));
}

export function createEditorPreferences(storage?: PrefsStorage) {
	const store: PrefsStorage | null = storage ?? (browser ? window.localStorage : null);

	let initial: StoredPrefs = {};
	try {
		const raw = store?.getItem(STORAGE_KEY);
		if (raw) {
			const parsed: unknown = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') initial = parsed as StoredPrefs;
		}
	} catch {
		// corrupt JSON / unavailable storage → defaults
	}

	let inspectorTab = $state<InspectorTab>(
		INSPECTOR_TABS.includes(initial.inspectorTab as InspectorTab)
			? (initial.inspectorTab as InspectorTab)
			: 'moments'
	);
	let inspectorWidth = $state(
		initial.inspectorWidth === undefined
			? INSPECTOR_DEFAULT_WIDTH
			: clampWidth(initial.inspectorWidth)
	);
	let snapping = $state(typeof initial.snapping === 'boolean' ? initial.snapping : true);

	function persist() {
		try {
			store?.setItem(STORAGE_KEY, JSON.stringify({ inspectorTab, inspectorWidth, snapping }));
		} catch {
			// quota / private mode — preferences just don't stick
		}
	}

	return {
		get inspectorTab() {
			return inspectorTab;
		},
		get inspectorWidth() {
			return inspectorWidth;
		},
		get snapping() {
			return snapping;
		},
		setInspectorTab(tab: InspectorTab) {
			inspectorTab = tab;
			persist();
		},
		setInspectorWidth(width: number) {
			inspectorWidth = clampWidth(width);
			persist();
		},
		setSnapping(value: boolean) {
			snapping = value;
			persist();
		},
		toggleSnapping() {
			snapping = !snapping;
			persist();
		}
	};
}
