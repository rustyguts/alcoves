import { redirect } from '@sveltejs/kit';
import { createApi } from '$lib/api';
import type { Library } from '$lib/types/api';
import type { LayoutServerLoad } from './$types';

/**
 * Authed-area guard + shell data. Redirects anonymous users to /login (preserving
 * the target), and loads the libraries list the dashboard sidebar renders. A
 * libraries fetch failure degrades to an empty list rather than failing the page.
 */
export const load: LayoutServerLoad = async ({ locals, url, fetch }) => {
	if (!locals.user) {
		throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const api = createApi(fetch);
	let libraries: Library[] = [];
	try {
		libraries = await api.libraries.list();
	} catch {
		// Degrade to an empty sidebar rather than failing the whole authed shell.
	}

	return { user: locals.user, libraries };
};
