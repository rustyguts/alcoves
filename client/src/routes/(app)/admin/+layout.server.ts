import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Owner-only guard for the admin area (instance role, not per-library). */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (locals.user?.role !== 'owner') {
		throw redirect(302, '/');
	}
	return {};
};
