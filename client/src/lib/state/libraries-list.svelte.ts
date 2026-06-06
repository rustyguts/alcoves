/**
 * Tiny app-wide singleton that lets any page trigger a refresh of the sidebar
 * library list without prop-drilling. The shell layout that owns the list calls
 * `registerLibrariesRefresh(fn)` once on mount; anywhere else (after creating,
 * joining, or mutating a library) calls `refreshLibraries()` to re-pull it.
 *
 * Ported from the Nuxt `useLibrariesList` composable. The Vue version held the
 * callback in a module-level `let`; here it is module-level `$state` so the slot
 * survives HMR and matches the rune-store conventions. The callback itself is not
 * reactive UI — only one is held at a time (last registration wins), and
 * `refreshLibraries` is a no-op when none is registered.
 */
let refreshFn = $state<(() => Promise<void>) | null>(null);

/** Register the active list-refresh callback. The most recent registration wins. */
export function registerLibrariesRefresh(fn: () => Promise<void>) {
	refreshFn = fn;
}

/** Invoke the registered refresh callback, if any. Safe to call when none is set. */
export async function refreshLibraries() {
	await refreshFn?.();
}
