import { describe, it, expect, vi } from 'vitest';
import { makeApiFetch, ApiError } from './fetch';

/** Build a fetch stub that records its call and returns the given Response. */
function recorder(response: Response) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return response;
	}) as unknown as typeof globalThis.fetch;
	return { fn, calls };
}

function json(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init
	});
}

describe('makeApiFetch', () => {
	it('does a GET and parses JSON by default', async () => {
		const { fn, calls } = recorder(json({ ok: true }));
		const apiFetch = makeApiFetch(fn);
		const result = await apiFetch<{ ok: boolean }>('/api/health');
		expect(result).toEqual({ ok: true });
		expect(calls[0].url).toBe('/api/health');
		expect(calls[0].init.method).toBe('GET');
		// Same-origin in node (no PUBLIC_API_ORIGIN).
		expect(calls[0].init.credentials).toBe('same-origin');
	});

	it('serializes query params and skips undefined/null', async () => {
		const { fn, calls } = recorder(json([]));
		const apiFetch = makeApiFetch(fn);
		await apiFetch('/api/x', { query: { a: '1', b: undefined, c: null, n: 5, t: true } });
		expect(calls[0].url).toBe('/api/x?a=1&n=5&t=true');
	});

	it('appends query with & when the path already has a query', async () => {
		const { fn, calls } = recorder(json([]));
		await makeApiFetch(fn)('/api/x?z=1', { query: { a: '2' } });
		expect(calls[0].url).toBe('/api/x?z=1&a=2');
	});

	it('JSON-encodes an object body and sets content-type', async () => {
		const { fn, calls } = recorder(json({}));
		await makeApiFetch(fn)('/api/x', { method: 'POST', body: { name: 'hi' } });
		expect(calls[0].init.method).toBe('POST');
		expect(calls[0].init.body).toBe('{"name":"hi"}');
		expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe(
			'application/json'
		);
	});

	it('passes FormData through without stringifying or setting content-type', async () => {
		const { fn, calls } = recorder(json({}));
		const fd = new FormData();
		fd.set('a', 'b');
		await makeApiFetch(fn)('/api/x', { method: 'POST', body: fd });
		expect(calls[0].init.body).toBe(fd);
		expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
	});

	it('returns a blob / text / null per responseType', async () => {
		const blob = await makeApiFetch(recorder(new Response('x')).fn)('/api/x', {
			responseType: 'blob'
		});
		expect(blob).toBeInstanceOf(Blob);
		const text = await makeApiFetch(recorder(new Response('hello')).fn)('/api/x', {
			responseType: 'text'
		});
		expect(text).toBe('hello');
		const empty = await makeApiFetch(recorder(new Response('')).fn)('/api/x');
		expect(empty).toBeNull();
	});

	it('throws ApiError with status and parsed body on non-2xx', async () => {
		const fn = recorder(json({ message: 'nope' }, { status: 403 })).fn;
		await expect(makeApiFetch(fn)('/api/x')).rejects.toMatchObject({
			name: 'ApiError',
			status: 403,
			message: 'nope'
		});
	});

	it('throws ApiError with null data when the error body is not JSON', async () => {
		const fn = recorder(new Response('boom', { status: 500 })).fn;
		const err = (await makeApiFetch(fn)('/api/x').catch((e) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(500);
		expect(err.data).toBeNull();
		expect(err.message).toBe('Request failed with status 500');
	});
});
