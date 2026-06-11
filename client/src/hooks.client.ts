import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error, message }) => {
	// Surface for local debugging; wire to Sentry in a later phase.
	console.error('[client error]', error);
	return { message };
};
