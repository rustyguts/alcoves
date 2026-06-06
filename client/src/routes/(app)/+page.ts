import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Home. Ported from the Nuxt `index.vue`, which redirected to the default
 * library. The authed shell ((app)/+layout.server.ts) already loaded the
 * libraries list, so we read it from `parent()` instead of refetching: send the
 * user straight to their default library (or the first one if none is flagged
 * default). With no libraries at all we fall through and render the empty /
 * create-first-library state in +page.svelte.
 */
export const load: PageLoad = async ({ parent }) => {
	const { libraries } = await parent();
	const def = libraries.find((l) => l.isDefault) ?? libraries[0];
	if (def) {
		throw redirect(307, `/libraries/${def.id}`);
	}
	return {};
};
