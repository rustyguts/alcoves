import type { LayoutServerLoad } from './$types';

/**
 * Root server load: expose the request's resolved user (from hooks.server.ts) to
 * every page via `data.user`. Authed-route guards live in (app)/+layout.server.ts.
 */
export const load: LayoutServerLoad = ({ locals }) => {
	return { user: locals.user };
};
