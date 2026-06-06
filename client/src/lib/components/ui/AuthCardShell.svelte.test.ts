import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import AuthCardShell from './AuthCardShell.svelte';

const textSnippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

describe('AuthCardShell', () => {
	it('renders title and subtitle', async () => {
		const screen = render(AuthCardShell, {
			props: { title: 'Sign In', subtitle: 'Welcome back' }
		});
		const h2 = screen.container.querySelector('h2')!;
		expect(h2.textContent).toBe('Sign In');
		expect(screen.container.textContent).toContain('Welcome back');
	});

	it('renders the logo image', async () => {
		const screen = render(AuthCardShell, {
			props: { title: 'Login', subtitle: 'Enter your credentials' }
		});
		const img = screen.container.querySelector('img')!;
		expect(img).not.toBeNull();
		expect(img.getAttribute('alt')).toBe('Alcoves');
		expect(img.getAttribute('src')).toBe('/logo.webp');
	});

	it('shows error message when error prop is provided', async () => {
		const screen = render(AuthCardShell, {
			props: { title: 'Login', subtitle: 'Enter credentials', error: 'Invalid password' }
		});
		const alert = screen.container.querySelector('[role="alert"]');
		expect(alert).not.toBeNull();
		expect(screen.container.textContent).toContain('Invalid password');
	});

	it('hides error message when error prop is empty', async () => {
		const screen = render(AuthCardShell, {
			props: { title: 'Login', subtitle: 'Enter credentials', error: '' }
		});
		expect(screen.container.querySelector('[role="alert"]')).toBeNull();
	});

	it('hides error message when error prop is not provided', async () => {
		const screen = render(AuthCardShell, {
			props: { title: 'Login', subtitle: 'Sub' }
		});
		expect(screen.container.querySelector('[role="alert"]')).toBeNull();
	});

	it('renders default children content', async () => {
		const screen = render(AuthCardShell, {
			props: {
				title: 'T',
				subtitle: 'S',
				children: textSnippet('<form>My Form</form>')
			}
		});
		expect(screen.container.querySelector('form')).not.toBeNull();
		expect(screen.container.textContent).toContain('My Form');
	});

	it('renders footer snippet content', async () => {
		const screen = render(AuthCardShell, {
			props: {
				title: 'T',
				subtitle: 'S',
				footer: textSnippet('<p>Footer text</p>')
			}
		});
		expect(screen.container.textContent).toContain('Footer text');
	});
});
