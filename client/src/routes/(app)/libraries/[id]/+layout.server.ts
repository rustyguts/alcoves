import { error } from '@sveltejs/kit';
import { createApi, ApiError } from '$lib/api';
import type { LayoutServerLoad } from './$types';

/** Load the library for the whole /libraries/[id] subtree; 404 on missing/forbidden. */
export const load: LayoutServerLoad = async ({ params, fetch }) => {
	const api = createApi(fetch);
	try {
		const library = await api.libraries.get(params.id);
		return { library };
	} catch (err) {
		if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
			throw error(404, 'Library not found');
		}
		throw err;
	}
};
