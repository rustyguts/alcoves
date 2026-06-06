import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/state', () => ({
	page: { status: 404, error: null }
}));

import ShareError from './+error.svelte';

describe('s/[token]/+error', () => {
	it('renders a branded not-found share message', async () => {
		const screen = render(ShareError);
		const text = screen.container.textContent ?? '';
		expect(text).toContain('404');
		expect(text).toContain('Moment not found');
		expect(text).toContain('no longer available');
	});
});
