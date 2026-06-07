import type { Handle, HandleFetch, RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { AuthUser } from '$lib/types/api';

/** Co-located Go API base for server-side calls and the /api proxy target. */
export const INTERNAL_API_URL = (env.INTERNAL_API_URL ?? 'http://localhost:3001').replace(
	/\/$/,
	''
);

/**
 * Resolve the current user from the session cookie by calling the Go API's
 * /api/_auth/session (which never 401s). Returns null when anonymous or when the
 * backend is unreachable — a backend hiccup must NOT turn every page into a 500.
 */
async function resolveUser(event: RequestEvent): Promise<AuthUser | null> {
	const cookie = event.request.headers.get('cookie');
	if (!cookie) return null; // No session cookie → anonymous (skip the round trip).
	try {
		const res = await event.fetch(`${INTERNAL_API_URL}/api/_auth/session`, {
			headers: { cookie }
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { user?: AuthUser | null };
		return data?.user ?? null;
	} catch {
		return null;
	}
}

/**
 * Proxy an OAuth `/.well-known/oauth-*` discovery request to the Go API and
 * relay the JSON response (status, content-type, and the CORS/cache headers the
 * backend set). A backend hiccup yields a 502 rather than a crash.
 */
async function forwardWellKnown(event: RequestEvent): Promise<Response> {
	const target = `${INTERNAL_API_URL}${event.url.pathname}${event.url.search}`;
	try {
		const res = await event.fetch(target);
		const body = await res.arrayBuffer();
		const headers = new Headers();
		for (const h of ['content-type', 'access-control-allow-origin', 'cache-control']) {
			const v = res.headers.get(h);
			if (v) headers.set(h, v);
		}
		return new Response(body, { status: res.status, headers });
	} catch {
		return new Response('upstream unavailable', { status: 502 });
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	// OAuth discovery documents (RFC 9728/8414) live at the domain root on the Go
	// API, but this front door only proxies /api/*. Forward them so the whole MCP
	// OAuth surface is reachable through one origin with zero operator config.
	if (event.url.pathname.startsWith('/.well-known/oauth-')) {
		return forwardWellKnown(event);
	}

	// The /api proxy forwards the raw cookie itself; resolving the session there
	// would be wasted work, so only do it for app navigations.
	if (event.url.pathname.startsWith('/api/')) {
		event.locals.user = null;
	} else {
		event.locals.user = await resolveUser(event);
	}
	return resolve(event);
};

/**
 * Rewrite same-origin `/api/*` fetches made inside server `load`/actions to the
 * internal Go API, forwarding the session cookie and `X-Forwarded-Host`/`-Proto`
 * (the latter is load-bearing: backend share.go builds absolute OG/share URLs
 * from the forwarded host).
 */
export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
	const url = new URL(request.url);
	if (url.pathname.startsWith('/api/') && url.origin === event.url.origin) {
		const target = new URL(url.pathname + url.search, INTERNAL_API_URL);
		const proxied = new Request(target, request);

		const cookie = event.request.headers.get('cookie');
		if (cookie) proxied.headers.set('cookie', cookie);

		const fwdHost =
			event.request.headers.get('x-forwarded-host') ?? event.request.headers.get('host');
		if (fwdHost) proxied.headers.set('x-forwarded-host', fwdHost);

		const proto =
			event.request.headers.get('x-forwarded-proto') ?? event.url.protocol.replace(':', '');
		proxied.headers.set('x-forwarded-proto', proto);

		return fetch(proxied);
	}
	return fetch(request);
};
