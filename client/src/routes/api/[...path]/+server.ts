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
 * In-process catch-all proxy: browser → SvelteKit → co-located Go API. Preserves
 * the unified single-image, single-origin topology so a same-origin `/api/*`
 * call (cookie auto-sent) reaches the API. Streams bodies in both directions and
 * passes status/headers through verbatim so Range (206), ETag, TUS, and
 * Set-Cookie all work. Binary GETs can bypass this entirely via PUBLIC_API_ORIGIN.
 */
const handler: RequestHandler = async ({ request, params, url }) => {
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
