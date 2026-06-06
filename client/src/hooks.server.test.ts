import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { INTERNAL_API_URL: 'http://api.internal:3001' } }));

import { handle, handleFetch, INTERNAL_API_URL } from './hooks.server';

function jsonResponse(data: unknown) {
	return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

/** Minimal RequestEvent stand-in for the bits the hooks touch. */
function makeEvent(opts: {
	pathname: string;
	headers?: Record<string, string>;
	fetch?: ReturnType<typeof vi.fn>;
}) {
	const headers = new Headers(opts.headers ?? {});
	return {
		url: new URL(`http://localhost${opts.pathname}`),
		request: new Request(`http://localhost${opts.pathname}`, { headers }),
		fetch: opts.fetch ?? vi.fn(),
		locals: {} as App.Locals
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

beforeEach(() => vi.clearAllMocks());

describe('INTERNAL_API_URL', () => {
	it('comes from env (trailing slash stripped)', () => {
		expect(INTERNAL_API_URL).toBe('http://api.internal:3001');
	});
});

describe('handle', () => {
	it('resolves locals.user from /api/_auth/session when a cookie is present', async () => {
		const fetch = vi.fn(async () => jsonResponse({ user: { id: 'u1', role: 'owner' } }));
		const event = makeEvent({
			pathname: '/profile',
			headers: { cookie: 'alcoves-session=x' },
			fetch
		});
		const resolve = vi.fn(async () => new Response('ok'));
		await handle({ event, resolve });
		expect(event.locals.user).toEqual({ id: 'u1', role: 'owner' });
		expect(fetch).toHaveBeenCalledWith('http://api.internal:3001/api/_auth/session', {
			headers: { cookie: 'alcoves-session=x' }
		});
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('is anonymous (no network call) when there is no cookie', async () => {
		const fetch = vi.fn();
		const event = makeEvent({ pathname: '/profile', fetch });
		await handle({ event, resolve: vi.fn(async () => new Response('ok')) });
		expect(event.locals.user).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('degrades to anonymous when the session endpoint errors or backend is down', async () => {
		const errEvent = makeEvent({
			pathname: '/profile',
			headers: { cookie: 'x=1' },
			fetch: vi.fn(async () => new Response('', { status: 500 }))
		});
		await handle({ event: errEvent, resolve: vi.fn(async () => new Response('ok')) });
		expect(errEvent.locals.user).toBeNull();

		const downEvent = makeEvent({
			pathname: '/profile',
			headers: { cookie: 'x=1' },
			fetch: vi.fn(async () => {
				throw new Error('ECONNREFUSED');
			})
		});
		await handle({ event: downEvent, resolve: vi.fn(async () => new Response('ok')) });
		expect(downEvent.locals.user).toBeNull();
	});

	it('skips session resolution for /api/* (the proxy forwards the cookie itself)', async () => {
		const fetch = vi.fn();
		const event = makeEvent({ pathname: '/api/libraries', headers: { cookie: 'x=1' }, fetch });
		await handle({ event, resolve: vi.fn(async () => new Response('ok')) });
		expect(event.locals.user).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('handleFetch', () => {
	it('rewrites same-origin /api/* to the internal API and forwards cookie + forwarded headers', async () => {
		let captured: Request | undefined;
		const fetch = vi.fn(async (req: Request) => {
			captured = req;
			return new Response('ok');
		});
		const event = makeEvent({
			pathname: '/s/abc',
			headers: { cookie: 'alcoves-session=x', host: 'alcoves.example' }
		});
		const request = new Request('http://localhost/api/share/abc', { method: 'GET' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await handleFetch({ event, request, fetch } as any);
		expect(captured!.url).toBe('http://api.internal:3001/api/share/abc');
		expect(captured!.headers.get('cookie')).toBe('alcoves-session=x');
		expect(captured!.headers.get('x-forwarded-host')).toBe('alcoves.example');
		expect(captured!.headers.get('x-forwarded-proto')).toBe('http');
	});

	it('prefers an existing x-forwarded-host over host', async () => {
		let captured: Request | undefined;
		const fetch = vi.fn(async (req: Request) => {
			captured = req;
			return new Response('ok');
		});
		const event = makeEvent({
			pathname: '/x',
			headers: { 'x-forwarded-host': 'public.example', host: 'internal.local' }
		});
		const request = new Request('http://localhost/api/x');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await handleFetch({ event, request, fetch } as any);
		expect(captured!.headers.get('x-forwarded-host')).toBe('public.example');
	});

	it('passes non-/api and cross-origin requests through untouched', async () => {
		const fetch = vi.fn(async (req: Request) => new Response('ok' + req.url));
		const event = makeEvent({ pathname: '/x' });

		const passthrough = new Request('http://localhost/not-api/thing');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await handleFetch({ event, request: passthrough, fetch } as any);
		expect(fetch).toHaveBeenCalledWith(passthrough);

		const external = new Request('https://external.com/api/x');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await handleFetch({ event, request: external, fetch } as any);
		expect(fetch).toHaveBeenCalledWith(external);
	});
});
