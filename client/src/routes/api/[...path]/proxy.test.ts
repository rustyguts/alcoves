import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { INTERNAL_API_URL: 'http://api.internal:3001' } }));

import { GET, POST, OPTIONS } from './+server';

let captured: { url: string; init: RequestInit } | undefined;

function stubUpstream(response: Response) {
	captured = undefined;
	const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		captured = { url: String(url), init: init ?? {} };
		return response;
	});
	vi.stubGlobal('fetch', fn);
	return fn;
}

function makeEvent(opts: {
	method: string;
	path: string;
	search?: string;
	headers?: Record<string, string>;
	body?: BodyInit;
}) {
	const fullPath = `/api/${opts.path}${opts.search ?? ''}`;
	const init: RequestInit = { method: opts.method, headers: opts.headers };
	if (opts.body !== undefined) {
		init.body = opts.body;
		(init as RequestInit & { duplex: 'half' }).duplex = 'half';
	}
	return {
		request: new Request(`http://localhost${fullPath}`, init),
		params: { path: opts.path },
		url: new URL(`http://localhost${fullPath}`)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

beforeEach(() => (captured = undefined));
afterEach(() => vi.unstubAllGlobals());

describe('/api proxy', () => {
	it('forwards a GET to the internal API preserving path, query, range, cookie; drops host', async () => {
		stubUpstream(
			new Response('partial', {
				status: 206,
				headers: {
					'content-range': 'bytes 0-9/100',
					'accept-ranges': 'bytes',
					'content-type': 'video/mp4'
				}
			})
		);
		const event = makeEvent({
			method: 'GET',
			path: 'libraries/L/files/F',
			search: '?inline=true',
			headers: { range: 'bytes=0-9', cookie: 'c=1', host: 'localhost' }
		});
		const res = await GET(event);

		expect(captured!.url).toBe('http://api.internal:3001/api/libraries/L/files/F?inline=true');
		expect(captured!.init.method).toBe('GET');
		const fwd = captured!.init.headers as Headers;
		expect(fwd.get('range')).toBe('bytes=0-9');
		expect(fwd.get('cookie')).toBe('c=1');
		expect(fwd.get('host')).toBeNull();

		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe('bytes 0-9/100');
		expect(res.headers.get('accept-ranges')).toBe('bytes');
	});

	it('streams a non-GET body with duplex:half', async () => {
		stubUpstream(new Response(null, { status: 204 }));
		const event = makeEvent({
			method: 'POST',
			path: 'tus',
			headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
			body: 'chunk-bytes'
		});
		const res = await POST(event);
		expect(captured!.init.method).toBe('POST');
		expect((captured!.init as RequestInit & { duplex?: string }).duplex).toBe('half');
		expect((captured!.init.headers as Headers).get('upload-offset')).toBe('0');
		expect(res.status).toBe(204);
	});

	it('strips content-encoding (and its stale content-length) from the upstream response', async () => {
		stubUpstream(
			new Response('{}', {
				status: 200,
				headers: {
					'content-encoding': 'gzip',
					'content-length': '2',
					'content-type': 'application/json'
				}
			})
		);
		const res = await GET(makeEvent({ method: 'GET', path: 'health' }));
		expect(res.headers.get('content-encoding')).toBeNull();
		expect(res.headers.get('content-length')).toBeNull();
		expect(res.headers.get('content-type')).toBe('application/json');
	});

	it('passes status codes through verbatim (e.g. 304)', async () => {
		stubUpstream(new Response(null, { status: 304 }));
		const res = await OPTIONS(makeEvent({ method: 'OPTIONS', path: 'tus' }));
		expect(res.status).toBe(304);
	});
});
