import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/state', () => ({
	page: { status: 404, error: { message: 'Library not found' } }
}));

import ErrorPage from './+error.svelte';

describe('+error', () => {
	it('renders the status, a 404 heading, and the error message', async () => {
		const screen = render(ErrorPage);
		const text = screen.container.textContent ?? '';
		expect(text).toContain('404');
		expect(text).toContain('Page not found');
		expect(text).toContain('Library not found');
		expect(screen.container.querySelector('a[href="/"]')).not.toBeNull();
	});
});
