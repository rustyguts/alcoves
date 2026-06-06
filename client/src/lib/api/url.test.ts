import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state shared with the mocked virtual modules.
const mocks = vi.hoisted(() => ({
	browser: false,
	env: {} as Record<string, string | undefined>
}));

vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	}
}));
vi.mock('$env/dynamic/public', () => ({ env: mocks.env }));

import { apiUrl, dataRequestUrl, clientUsesCrossOrigin } from './url';

beforeEach(() => {
	mocks.browser = false;
	mocks.env.PUBLIC_API_ORIGIN = undefined;
});

describe('apiUrl (asset/stream builder — browser perspective on both sides)', () => {
	it('returns a relative path when no PUBLIC_API_ORIGIN is set', () => {
		expect(apiUrl('/api/x')).toBe('/api/x');
	});

	it('prefixes PUBLIC_API_ORIGIN (even on the server) and strips a trailing slash', () => {
		mocks.env.PUBLIC_API_ORIGIN = 'https://api.example.com/';
		expect(apiUrl('/api/x')).toBe('https://api.example.com/api/x');
		mocks.browser = true;
		expect(apiUrl('/api/x')).toBe('https://api.example.com/api/x');
	});

	it('passes through absolute URLs and empty input unchanged', () => {
		mocks.env.PUBLIC_API_ORIGIN = 'https://api.example.com';
		expect(apiUrl('https://other/x')).toBe('https://other/x');
		expect(apiUrl('')).toBe('');
	});
});

describe('dataRequestUrl (JSON fetch URL)', () => {
	it('stays relative on the server regardless of PUBLIC_API_ORIGIN', () => {
		mocks.env.PUBLIC_API_ORIGIN = 'https://api.example.com';
		expect(dataRequestUrl('/api/x')).toBe('/api/x');
	});

	it('stays relative in the browser when no PUBLIC_API_ORIGIN (proxy path)', () => {
		mocks.browser = true;
		expect(dataRequestUrl('/api/x')).toBe('/api/x');
	});

	it('goes direct to PUBLIC_API_ORIGIN in the browser when set', () => {
		mocks.browser = true;
		mocks.env.PUBLIC_API_ORIGIN = 'https://api.example.com';
		expect(dataRequestUrl('/api/x')).toBe('https://api.example.com/api/x');
	});

	it('passes through absolute URLs', () => {
		expect(dataRequestUrl('http://x/y')).toBe('http://x/y');
	});
});

describe('clientUsesCrossOrigin', () => {
	it('is false on the server', () => {
		mocks.env.PUBLIC_API_ORIGIN = 'https://api.example.com';
		expect(clientUsesCrossOrigin()).toBe(false);
	});

	it('is false in the browser with no PUBLIC_API_ORIGIN (same-origin proxy)', () => {
		mocks.browser = true;
		expect(clientUsesCrossOrigin()).toBe(false);
	});

	it('is true in the browser with a PUBLIC_API_ORIGIN', () => {
		mocks.browser = true;
		mocks.env.PUBLIC_API_ORIGIN = 'https://api.example.com';
		expect(clientUsesCrossOrigin()).toBe(true);
	});
});
