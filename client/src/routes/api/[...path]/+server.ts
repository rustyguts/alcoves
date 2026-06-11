import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const INTERNAL_API_URL = (env.INTERNAL_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

/**
 * Headers we must NOT copy verbatim from the incoming request to the upstream
 * (hop-by-hop / connection-scoped, or recomputed by fetch).
 */
const REQUEST_STRIP = new Set([
	'connection',
	'keep-alive',
	'transfer-encoding',
	'upgrade',
	'host',
	'content-length'
]);

/**
 * Form content types a cross-site page can submit with a plain `<form>` —
 * mirrors SvelteKit's own `is_form_content_type` list.
 */
const FORM_CONTENT_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain'
];
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Browser-CSRF guard for the proxy, replacing SvelteKit's global
 * `csrf.checkOrigin` (disabled in svelte.config.js — see the comment there).
 * Browsers always attach an `Origin` header to cross-site form submissions, so
 * a present-but-mismatched Origin is the CSRF signal and is rejected. An absent
 * Origin means a non-browser client — e.g. an OAuth client's form-encoded
 * token exchange at /api/oauth/token — which cannot ride a victim's session
 * (and the session cookie is SameSite=Lax besides). SvelteKit's built-in check
 * rejects those origin-less posts too, which would break the MCP OAuth flow
 * through this proxy.
 */
function isCrossSiteFormSubmission(request: Request, url: URL): boolean {
	if (!MUTATING_METHODS.has(request.method)) return false;
	const type = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
	if (!FORM_CONTENT_TYPES.includes(type)) return false;
	const origin = request.headers.get('origin');
	return origin !== null && origin !== url.origin;
}

/**
 * In-process catch-all proxy: browser → SvelteKit → co-located Go API. Preserves
 * the unified single-image, single-origin topology so a same-origin `/api/*`
 * call (cookie auto-sent) reaches the API. Streams bodies in both directions and
 * passes status/headers through verbatim so Range (206), ETag, TUS, and
 * Set-Cookie all work. Binary GETs can bypass this entirely via PUBLIC_API_ORIGIN.
 */
const handler: RequestHandler = async ({ request, params, url }) => {
	if (isCrossSiteFormSubmission(request, url)) {
		return new Response(`Cross-site ${request.method} form submissions are forbidden`, {
			status: 403
		});
	}

	const path = params.path ?? '';
	const target = `${INTERNAL_API_URL}/api/${path}${url.search}`;

	const headers = new Headers();
	for (const [key, value] of request.headers) {
		if (!REQUEST_STRIP.has(key.toLowerCase())) headers.set(key, value);
	}

	const init: RequestInit = { method: request.method, headers, redirect: 'manual' };
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = request.body;
		// Required by undici/Bun when streaming a request body (TUS PATCH chunks).
		(init as RequestInit & { duplex: 'half' }).duplex = 'half';
	}

	const upstream = await fetch(target, init);

	// `fetch` transparently decodes content-encoding, so the original
	// content-encoding/content-length no longer describe the streamed body.
	const hadEncoding = upstream.headers.has('content-encoding');
	const responseHeaders = new Headers();
	for (const [key, value] of upstream.headers) {
		const lk = key.toLowerCase();
		if (lk === 'content-encoding') continue;
		if (lk === 'content-length' && hadEncoding) continue;
		responseHeaders.set(key, value);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders
	});
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
