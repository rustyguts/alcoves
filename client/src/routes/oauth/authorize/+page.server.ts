import { redirect } from '@sveltejs/kit';
import { createApi, ApiError } from '$lib/api';
import type { PageServerLoad } from './$types';

// Authorization-request params we pass through to the backend validator.
const PASS_PARAMS = [
	'client_id',
	'redirect_uri',
	'response_type',
	'code_challenge',
	'code_challenge_method',
	'scope',
	'state',
	'resource'
] as const;

export const load: PageServerLoad = async (event) => {
	const { url, locals } = event;

	// Consent requires an authenticated user; bounce anon visitors to login and
	// back (safeRedirect on the login page rejects off-site targets).
	if (!locals.user) {
		const target = url.pathname + url.search;
		redirect(302, `/login?redirect=${encodeURIComponent(target)}`);
	}

	const query: Record<string, string> = {};
	for (const key of PASS_PARAMS) {
		const v = url.searchParams.get(key);
		if (v) query[key] = v;
	}

	const api = createApi(event.fetch);
	try {
		const info = await api.oauth.authorize(query);
		return { ok: true as const, info, userName: locals.user.displayName || locals.user.email };
	} catch (err) {
		const description =
			err instanceof ApiError && typeof err.data?.error_description === 'string'
				? err.data.error_description
				: 'This authorization request is invalid or has expired.';
		return { ok: false as const, error: description };
	}
};
