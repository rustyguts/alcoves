import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
// Real compiled Tailwind so getComputedStyle sees actual box dimensions — the
// elongation-bug regression test below asserts RENDERED width/height/radius,
// not class strings, because the bug (tailwind-merge dropping the vendored
// Avatar.Root's `size-8` when a caller passed a `w-*` override) was invisible
// to class-name assertions. Companion to checked-state.svelte.test.ts.
import '../../../app.css';
import UserAvatar from './UserAvatar.svelte';
import UserAvatarTableHarness from './UserAvatarTableHarness.svelte';

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

	it.each([
		['xs', 'size-6'],
		['sm', 'size-7'],
		['md', 'size-8'],
		['lg', 'size-10']
	] as const)('maps size="%s" to the %s class (never a free-form w-*/h-*)', async (size, cls) => {
		const screen = render(UserAvatar, {
			props: { displayName: 'Sized', size }
		});
		const root = screen.container.querySelector('[data-slot="avatar"]')!;
		expect(root.className).toContain(cls);
		expect(root.className).toContain('shrink-0');
	});

	it('defaults to size="md" (size-8) when no size is given', async () => {
		const screen = render(UserAvatar, { props: { displayName: 'Default' } });
		const root = screen.container.querySelector('[data-slot="avatar"]')!;
		expect(root.className).toContain('size-8');
	});

	it('applies bgClass to the fallback initial', async () => {
		const screen = render(UserAvatar, {
			props: { displayName: 'Tinted', bgClass: 'bg-primary/10 text-primary' }
		});
		const fallback = screen.container.querySelector('[data-slot="avatar-fallback"]')!;
		expect(fallback.className).toContain('bg-primary/10');
		expect(fallback.className).toContain('text-primary');
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

	// Elongation-bug regression net: every size, rendered inside a real
	// <table><tbody><tr><td> (LibraryEntriesTable's owner-avatar column is
	// where this was originally spotted), must come out perfectly square with
	// a full circular radius — never stretched by a dropped `size-*` class.
	it.each(['xs', 'sm', 'md', 'lg'] as const)(
		'renders a perfectly circular size="%s" avatar inside a table row',
		async (size) => {
			render(UserAvatarTableHarness);
			await tick();
			const avatarRoot = document.querySelector<HTMLElement>(
				`[data-testid="cell-${size}"] [data-slot="avatar"]`
			);
			expect(avatarRoot).not.toBeNull();
			const rect = avatarRoot!.getBoundingClientRect();
			expect(rect.width).toBeGreaterThan(0);
			expect(rect.width).toBe(rect.height);
			const radius = parseFloat(getComputedStyle(avatarRoot!).borderRadius);
			expect(radius).toBeGreaterThanOrEqual(rect.width / 2 - 0.5);
		}
	);
});
