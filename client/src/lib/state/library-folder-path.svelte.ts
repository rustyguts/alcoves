import type { FolderBreadcrumb } from '$lib/types/api';

/**
 * Shared module-singleton for the current Files-tab folder ancestry.
 *
 * The library header (rendered by the library layout, the *parent*) needs the
 * folder breadcrumb that the Files page (the *child*) computes. Props only flow
 * parent→child, so the page publishes its path here and the header reads it. The
 * path holds only the folder ancestors — the header prepends the library-name
 * root crumb. It is empty on the library root, in trash, and on every non-Files
 * tab (the page clears it on unmount).
 *
 * Ported from the Nuxt `useState`-based `useLibraryFolderPath` composable: the
 * single shared array becomes module-level `$state` exposed through a getter,
 * with an explicit setter and clearer the page calls from its lifecycle hooks.
 */
let path = $state<FolderBreadcrumb[]>([]);

export const libraryFolderPath = {
	/** The current folder ancestry (empty at the library root / outside Files). */
	get value(): FolderBreadcrumb[] {
		return path;
	},
	/** Publish the current folder ancestry (the Files page calls this). */
	set(crumbs: FolderBreadcrumb[]) {
		path = crumbs;
	},
	/** Reset to empty (the Files page calls this on unmount). */
	clear() {
		path = [];
	}
};
