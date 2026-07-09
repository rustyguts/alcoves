import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NotificationItem from './NotificationItem.svelte';
import type { Activity } from '$lib/types/api';
import type { ActivityGroup } from '$lib/utils/activity-format';

function makeGroup(over: Partial<Activity> = {}, count = 1): ActivityGroup {
	const head: Activity = {
		id: 'id-head',
		libraryId: 'lib-1',
		libraryName: 'Family',
		actor: { id: 'u1', displayName: 'Alice', avatarUrl: null },
		action: 'file.created',
		subjectType: 'file',
		subjectId: 'file-1',
		metadata: { name: 'photo.jpg' },
		createdAt: new Date().toISOString(),
		dismissed: false,
		...over
	};
	return { head, items: [head], count };
}

describe('NotificationItem', () => {
	it('renders actor display name and file name', async () => {
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: false }
		});
		await expect.element(screen.getByText('Alice added photo.jpg')).toBeInTheDocument();
	});

	it('renders library name when showLibraryName is true', async () => {
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: true, showDismiss: false }
		});
		expect(screen.container.textContent).toContain('Family');
	});

	it('does not render library name when showLibraryName is false', async () => {
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: false }
		});
		expect(screen.container.textContent).not.toContain('Family');
	});

	it('renders bulk format for grouped file.created', async () => {
		const head: Activity = {
			id: 'h',
			libraryId: 'lib-1',
			actor: { id: 'u1', displayName: 'Alice', avatarUrl: null },
			action: 'file.created',
			subjectType: 'file',
			subjectId: null,
			metadata: {},
			createdAt: new Date().toISOString(),
			dismissed: false
		};
		const screen = render(NotificationItem, {
			props: {
				group: { head, items: [head, head, head], count: 3 },
				showLibraryName: false,
				showDismiss: false
			}
		});
		await expect.element(screen.getByText('Alice added 3 files')).toBeInTheDocument();
	});

	it('renders an <a> when href is available', async () => {
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: false }
		});
		const anchor = screen.container.querySelector('a');
		expect(anchor).not.toBeNull();
		expect(anchor!.getAttribute('href')).toMatch(/^\/libraries\/lib-1/);
	});

	it('renders a non-anchor for actions without href (e.g. file.deleted)', async () => {
		const screen = render(NotificationItem, {
			props: {
				group: makeGroup({ action: 'file.deleted', metadata: { name: 'x' } }),
				showLibraryName: false,
				showDismiss: false
			}
		});
		expect(screen.container.querySelector('a')).toBeNull();
		expect(screen.container.querySelector('[role="button"]')).not.toBeNull();
	});

	it('calls ondismiss with the activity ids when X is clicked', async () => {
		const ondismiss = vi.fn();
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: true, ondismiss }
		});
		const btn = screen.getByRole('button', { name: 'Dismiss notification' });
		await expect.element(btn).toBeInTheDocument();
		await btn.click();
		expect(ondismiss).toHaveBeenCalledWith(['id-head']);
	});

	// F22: the dismiss button must reveal on keyboard focus (not just hover),
	// with a visible focus ring, so it isn't invisible while tabbed to.
	it('reveals the dismiss button on focus-visible with a visible ring', async () => {
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: true }
		});
		const btn = screen.getByRole('button', { name: 'Dismiss notification' });
		const el = await btn.element();
		expect(el.className).toContain('focus-visible:opacity-100');
		expect(el.className).toContain('focus-visible:ring-2');
	});

	it('does not render dismiss button when showDismiss=false', async () => {
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: false }
		});
		expect(screen.container.querySelector('button[aria-label="Dismiss notification"]')).toBeNull();
	});

	it('calls onnavigate with href when the row is clicked', async () => {
		const onnavigate = vi.fn();
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: false, onnavigate }
		});
		await screen.getByText('Alice added photo.jpg').click();
		expect(onnavigate).toHaveBeenCalledTimes(1);
		expect(onnavigate.mock.calls[0][0]).toMatch(/^\/libraries\/lib-1/);
	});

	it('does not call onnavigate when a modifier key is held', async () => {
		const onnavigate = vi.fn();
		const screen = render(NotificationItem, {
			props: { group: makeGroup(), showLibraryName: false, showDismiss: false, onnavigate }
		});
		const row = screen.container.querySelector('a')!;
		row.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
		expect(onnavigate).not.toHaveBeenCalled();
	});
});
