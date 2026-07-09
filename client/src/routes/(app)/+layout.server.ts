import { redirect } from '@sveltejs/kit';
import { createApi } from '$lib/api';
import type { Library } from '$lib/types/api';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';
import type { LayoutServerLoad } from './$types';

/**
 * Authed-area guard + shell data. Redirects anonymous users to /login (preserving
 * the target), and loads the libraries list the dashboard sidebar renders. A
 * libraries fetch failure degrades to an empty list rather than failing the page.
 */
export const load: LayoutServerLoad = async ({ locals, url, fetch, cookies }) => {
	if (!locals.user) {
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const api = createApi(fetch);
	let libraries: Library[] = [];
	let librariesError = false;
	try {
		libraries = await api.libraries.list();
	} catch {
		// Degrade to an empty sidebar rather than failing the whole authed shell,
		// but flag the failure so the sidebar can distinguish "no libraries" from
		// "couldn't load".
		librariesError = true;
	}

	// F18 rework: Sidebar.Provider's vendored `setOpen` writes the collapse state
	// to a cookie but nothing read it back, so a reload/SSR nav always reopened
	// the sidebar. Read it here and pass it into the layout's `Sidebar.Provider
	// open` prop (below) so the collapsed state survives reload without flicker.
	// Absent/malformed cookie defaults to open, matching the primitive's own
	// `open = $bindable(true)` default.
	const sidebarOpen = cookies.get(SIDEBAR_COOKIE_NAME) !== 'false';

	return { user: locals.user, libraries, librariesError, sidebarOpen };
};
