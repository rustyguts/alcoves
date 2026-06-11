import { browser } from '$app/environment';

export type ColorPreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'alcoves.theme';

function isPreference(v: unknown): v is ColorPreference {
	return v === 'system' || v === 'light' || v === 'dark';
}

/**
 * Color-scheme store. The persisted preference drives the `.dark` class on
 * <html> (Skeleton's class-based dark variant). The pre-paint bootstrap in
 * app.html applies the initial class; `init()` (called from the root layout
 * onMount) re-syncs and subscribes to OS changes.
 */
class ThemeStore {
	preference = $state<ColorPreference>('system');
	systemPrefersDark = $state(false);

	readonly resolved = $derived<'light' | 'dark'>(
		this.preference === 'system' ? (this.systemPrefersDark ? 'dark' : 'light') : this.preference
	);

	init() {
		if (!browser) return;
		const stored = localStorage.getItem(STORAGE_KEY);
		if (isPreference(stored)) this.preference = stored;
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		this.systemPrefersDark = mq.matches;
		mq.addEventListener('change', (e) => {
			this.systemPrefersDark = e.matches;
			this.apply();
		});
		this.apply();
	}

	set(pref: ColorPreference) {
		this.preference = pref;
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, pref);
		this.apply();
	}

	apply() {
		if (browser) document.documentElement.classList.toggle('dark', this.resolved === 'dark');
	}
}

export const theme = new ThemeStore();
