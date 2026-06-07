import { describe, it, expect } from 'vitest';
import { api, createApi, apiUrl, ApiError } from './index';

describe('api barrel', () => {
	it('exposes the browser singleton with all 16 resource namespaces', () => {
		expect(Object.keys(api).sort()).toEqual([
			'admin',
			'auth',
			'downloads',
			'files',
			'folders',
			'highlightFilters',
			'invites',
			'libraries',
			'members',
			'meta',
			'moments',
			'oauth',
			'objects',
			'people',
			'search',
			'tags'
		]);
	});

	it('re-exports the factory and helpers', () => {
		expect(typeof createApi).toBe('function');
		expect(typeof apiUrl).toBe('function');
		expect(new ApiError(404, null)).toBeInstanceOf(Error);
	});
});
