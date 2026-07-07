import { clientUsesCrossOrigin, dataRequestUrl } from './url';

/** Thrown on a non-2xx API response. Carries the status and parsed JSON body. */
export class ApiError extends Error {
	status: number;
	data: Record<string, unknown> | null;

	constructor(status: number, data: Record<string, unknown> | null) {
		const message =
			(data?.message as string) ??
			(data?.statusMessage as string) ??
			`Request failed with status ${status}`;
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.data = data;
	}
}

export interface ApiFetchOptions {
	method?: string;
	body?: unknown;
	query?: Record<string, string | number | boolean | undefined | null>;
	responseType?: 'json' | 'blob' | 'text';
	headers?: Record<string, string>;
	/** Let the request outlive the page (best-effort unload writes; ~64KB body cap). */
	keepalive?: boolean;
}

export type ApiFetch = <T = unknown>(path: string, options?: ApiFetchOptions) => Promise<T>;

/**
 * Create an isomorphic `apiFetch` bound to a specific `fetch` implementation.
 *
 * - Server `load`/actions pass `event.fetch` (relative `/api/*` → handleFetch
 *   rewrites to the Go API and forwards the cookie).
 * - Browser code passes `window.fetch` (relative → SvelteKit /api proxy, or
 *   PUBLIC_API_ORIGIN direct).
 *
 * Cookie forwarding is intentionally NOT done here — on the server it lives in
 * `hooks.server.ts handleFetch`; in the browser the cookie rides along
 * automatically (same-origin) or via `credentials: 'include'` (cross-origin).
 */
export function makeApiFetch(fetchImpl: typeof globalThis.fetch): ApiFetch {
	return async function apiFetch<T = unknown>(
		path: string,
		options: ApiFetchOptions = {}
	): Promise<T> {
		const { method = 'GET', body, query, responseType = 'json', headers = {}, keepalive } = options;

		let url = dataRequestUrl(path);
		if (query) {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(query)) {
				if (value !== undefined && value !== null) params.set(key, String(value));
			}
			const qs = params.toString();
			if (qs) url += (url.includes('?') ? '&' : '?') + qs;
		}

		const finalHeaders: Record<string, string> = { ...headers };
		const init: RequestInit = {
			method,
			headers: finalHeaders,
			credentials: clientUsesCrossOrigin() ? 'include' : 'same-origin'
		};
		if (keepalive) init.keepalive = true;

		if (body !== undefined) {
			if (body instanceof FormData) {
				init.body = body;
			} else {
				finalHeaders['Content-Type'] = 'application/json';
				init.body = JSON.stringify(body);
			}
		}

		const response = await fetchImpl(url, init);

		if (!response.ok) {
			let data: Record<string, unknown> | null = null;
			try {
				data = await response.json();
			} catch {
				// Response body may not be JSON.
			}
			throw new ApiError(response.status, data);
		}

		if (responseType === 'blob') return (await response.blob()) as T;
		if (responseType === 'text') return (await response.text()) as T;

		const text = await response.text();
		if (!text) return null as T;
		return JSON.parse(text) as T;
	};
}
