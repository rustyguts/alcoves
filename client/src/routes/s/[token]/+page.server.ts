import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Public moment-share metadata, SSR'd so OG/Twitter crawlers see real meta tags. */
export interface ShareMetadata {
	token: string;
	title: string;
	description: string;
	shareUrl: string;
	appUrl: string;
	videoUrl?: string;
	thumbnailUrl?: string;
	ready: boolean;
}

/**
 * Fetch the share metadata server-side. The relative `/api/share/:token` is
 * rewritten to the Go API by hooks.server.ts `handleFetch`, which also forwards
 * `X-Forwarded-Host`/`-Proto` so the backend builds absolute, correct OG URLs.
 * A missing share is a hard 404 (the page is public and outside the authed shell).
 */
export const load: PageServerLoad = async ({ params, fetch }) => {
	const res = await fetch(`/api/share/${params.token}`);
	if (!res.ok) throw error(404, 'Share not found');
	const meta = (await res.json()) as ShareMetadata;
	return { meta };
};
