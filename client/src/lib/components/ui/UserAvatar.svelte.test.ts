import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import UserAvatar from './UserAvatar.svelte';

describe('UserAvatar', () => {
	it('renders the upper-cased first initial when no avatar URL', async () => {
		const screen = render(UserAvatar, { props: { displayName: 'John Doe' } });
		await expect.element(screen.getByText('J')).toBeInTheDocument();
	});

	it('renders an image with apiUrl src and the display name as alt', async () => {
		const screen = render(UserAvatar, {
			props: { displayName: 'John Doe', avatarUrl: '/images/john.jpg' }
		});
		const img = screen.container.querySelector('[data-slot="avatar-image"]')!;
		expect(img).not.toBeNull();
		// apiUrl is identity for relative paths under the test env stub.
		expect(img.getAttribute('src')).toBe('/images/john.jpg');
		expect(img.getAttribute('alt')).toBe('John Doe');
	});

	it('renders the text fallback when avatarUrl is null', async () => {
		const screen = render(UserAvatar, {
			props: { displayName: 'Test User', avatarUrl: null }
		});
		expect(screen.container.querySelector('[data-slot="avatar-image"]')).toBeNull();
		await expect.element(screen.getByText('T')).toBeInTheDocument();
	});

	it('applies sizeClass directly to the avatar root', async () => {
		const screen = render(UserAvatar, {
			props: { displayName: 'Sized', sizeClass: 'size-16' }
		});
		const root = screen.container.querySelector('[data-slot="avatar"]')!;
		expect(root.className).toContain('size-16');
	});

	it('applies a custom roundedClass when provided', async () => {
		const screen = render(UserAvatar, {
			props: { displayName: 'Rounded', avatarUrl: '/r.jpg', roundedClass: 'rounded-md' }
		});
		const img = screen.container.querySelector('[data-slot="avatar-image"]')!;
		expect(img.className).toContain('rounded-md');
		expect(img.className).not.toContain('rounded-full');
	});

	it('wraps the avatar in a tooltip trigger when tooltip is true', async () => {
		const screen = render(UserAvatar, {
			props: { displayName: 'Jane', tooltip: true }
		});
		const trigger = screen.container.querySelector('[aria-label="Jane"]');
		expect(trigger).not.toBeNull();
		expect(trigger?.querySelector('[data-slot="avatar-fallback"]')?.textContent?.trim()).toBe('J');
	});

	it('does not wrap with a tooltip trigger by default', async () => {
		const screen = render(UserAvatar, { props: { displayName: 'Jane' } });
		expect(screen.container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
		await expect.element(screen.getByText('J')).toBeInTheDocument();
	});
});
