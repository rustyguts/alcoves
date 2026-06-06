import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

/** Public API origin for direct browser streaming, or '' for same-origin proxy. */
function publicOrigin(): string {
	return (env.PUBLIC_API_ORIGIN ?? '').replace(/\/$/, '');
}

/**
 * Build a browser-facing URL for an API asset/stream (`<img>`/`<video>` src,
 * downloads, thumbnails). Uses PUBLIC_API_ORIGIN when set (direct to the Go API,
 * avoiding Range mangling through the proxy), otherwise a same-origin relative
 * path routed through the SvelteKit /api proxy. Correct on both server and
 * browser because it always targets the browser's perspective — so URLs rendered
 * during SSR resolve correctly once hydrated.
 */
export function apiUrl(path: string): string {
	if (!path) return path;
	if (/^https?:\/\//i.test(path)) return path;
	const origin = publicOrigin();
	return origin ? origin + path : path;
}

/**
 * Resolve the URL for a data fetch (JSON API calls). On the server the path stays
 * relative so SvelteKit's `event.fetch` + `handleFetch` rewrite it to
 * INTERNAL_API_URL and forward the session cookie. In the browser it uses
 * PUBLIC_API_ORIGIN when set, else a relative path through the /api proxy.
 */
export function dataRequestUrl(path: string): string {
	if (/^https?:\/\//i.test(path)) return path;
	if (browser) return apiUrl(path);
	return path;
}

/**
 * True when browser requests cross the API origin and therefore need
 * `credentials: 'include'` to forward the session cookie. Same-origin (proxy)
 * requests use `same-origin` credentials.
 */
export function clientUsesCrossOrigin(): boolean {
	return browser && publicOrigin() !== '';
}
