import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import OAuthGoogleButton from './OAuthGoogleButton.svelte';

describe('OAuthGoogleButton', () => {
	it('renders the default label and a full-navigation link to the Google OAuth endpoint', async () => {
		const screen = render(OAuthGoogleButton);
		const link = screen.container.querySelector('a')!;
		expect(link).not.toBeNull();
		expect(link.textContent).toContain('Continue with Google');
		expect(link.getAttribute('href')).toBe('/api/auth/google');
		// `rel="external"` keeps it a real document navigation, not a client-side route.
		expect(link.getAttribute('rel')).toBe('external');
	});

	it('renders the four-path Google logo mark', async () => {
		const screen = render(OAuthGoogleButton);
		const svg = screen.container.querySelector('svg');
		expect(svg).not.toBeNull();
		expect(svg?.querySelectorAll('path').length).toBe(4);
	});

	it('honors a custom href', async () => {
		const screen = render(OAuthGoogleButton, {
			props: { href: '/api/auth/google?redirect=/profile' }
		});
		const link = screen.container.querySelector('a')!;
		expect(link.getAttribute('href')).toBe('/api/auth/google?redirect=/profile');
	});

	it('honors a custom label', async () => {
		const screen = render(OAuthGoogleButton, { props: { label: 'Sign in with Google' } });
		const link = screen.container.querySelector('a')!;
		expect(link.textContent).toContain('Sign in with Google');
	});

	it('drops the block (full-width) class when block is false', async () => {
		const blocked = render(OAuthGoogleButton, { props: { block: true } });
		expect(blocked.container.querySelector('a')!.className).toContain('w-full');

		const inline = render(OAuthGoogleButton, { props: { block: false } });
		expect(inline.container.querySelector('a')!.className).not.toContain('w-full');
	});
});
