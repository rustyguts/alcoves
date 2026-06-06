import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Activity } from '$lib/types/api';

// Mock navigation — capture goto calls.
const goto = vi.fn();
vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => goto(...args)
}));

// Mock the global notifications store. It is a singleton with $state-backed
// fields; here we expose a plain object whose fields the test mutates before
// each render, plus spy methods. `vi.hoisted` makes the shared handles
// available to the hoisted `vi.mock` factory.
const { store, loadFirst, dismiss, dismissAll } = vi.hoisted(() => {
	const loadFirst = vi.fn();
	const dismiss = vi.fn();
	const dismissAll = vi.fn(() => Promise.resolve());
	return {
		loadFirst,
		dismiss,
		dismissAll,
		store: {
			entries: [] as Activity[],
			loading: false,
			nextCursor: null as string | null,
			loadFirst,
			dismiss,
			dismissAll
		}
	};
});

vi.mock('$lib/state/notifications.svelte', () => ({
	notifications: store
}));

import NotificationDropdown from './NotificationDropdown.svelte';

function makeActivity(id: string): Activity {
	return {
		id,
		libraryId: 'lib1',
		actor: { id: 'u', displayName: 'Alice', avatarUrl: null },
		action: 'file.created',
		subjectType: 'file',
		subjectId: 'f',
		metadata: { name: id },
		createdAt: '2026-01-01T00:00:00Z',
		dismissed: false
	} as Activity;
}

beforeEach(() => {
	goto.mockClear();
	loadFirst.mockClear();
	dismiss.mockClear();
	dismissAll.mockClear();
	store.entries = [];
	store.loading = false;
	store.nextCursor = null;
});

describe('NotificationDropdown', () => {
	it('loads the first page on mount when empty', async () => {
		render(NotificationDropdown, { props: {} });
		expect(loadFirst).toHaveBeenCalledTimes(1);
	});

	it('does not load when entries already exist', async () => {
		store.entries = [makeActivity('a1')];
		render(NotificationDropdown, { props: {} });
		expect(loadFirst).not.toHaveBeenCalled();
	});

	it('shows the loading state on first load', async () => {
		store.loading = true;
		const screen = render(NotificationDropdown, { props: {} });
		await expect.element(screen.getByText('Loading…')).toBeInTheDocument();
	});

	it('shows the empty state when there are no notifications', async () => {
		const screen = render(NotificationDropdown, { props: {} });
		await expect.element(screen.getByText("You're all caught up.")).toBeInTheDocument();
	});

	it('renders grouped notification items and a dismiss-all button', async () => {
		// Two distinct actions so they do not merge into one group.
		store.entries = [makeActivity('a1'), makeActivity('a2')];
		const screen = render(NotificationDropdown, { props: {} });
		// At least one rendered row links to the library.
		expect(screen.container.querySelector('a[href^="/libraries/lib1"]')).not.toBeNull();
		const dismissAllBtn = screen.getByRole('button', { name: 'Dismiss all' });
		await expect.element(dismissAllBtn).toBeInTheDocument();
		await dismissAllBtn.click();
		expect(dismissAll).toHaveBeenCalled();
	});

	it('forwards dismiss from a notification item to the store', async () => {
		store.entries = [makeActivity('a1')];
		const screen = render(NotificationDropdown, { props: {} });
		const dismissBtn = screen.getByRole('button', { name: 'Dismiss notification' });
		await expect.element(dismissBtn).toBeInTheDocument();
		await dismissBtn.click();
		expect(dismiss).toHaveBeenCalledWith('a1');
	});

	it('navigates and calls onclose when a notification item is clicked', async () => {
		const onclose = vi.fn();
		store.entries = [makeActivity('a1')];
		const screen = render(NotificationDropdown, { props: { onclose } });
		await screen.getByText('Alice added a1').click();
		expect(goto).toHaveBeenCalledTimes(1);
		expect(goto.mock.calls[0][0]).toMatch(/^\/libraries\/lib1/);
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it("shows a 'See all' button when there is more and navigates to /notifications", async () => {
		const onclose = vi.fn();
		store.entries = [makeActivity('a1')];
		store.nextCursor = 'cursor-2';
		const screen = render(NotificationDropdown, { props: { onclose } });
		const seeAll = screen.getByRole('button', { name: 'See all notifications' });
		await expect.element(seeAll).toBeInTheDocument();
		await seeAll.click();
		expect(goto).toHaveBeenCalledWith('/notifications');
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('does not show the See all button when there is no more', async () => {
		store.entries = [makeActivity('a1')];
		store.nextCursor = null;
		const screen = render(NotificationDropdown, { props: {} });
		expect(screen.container.querySelector('button')?.textContent?.includes('See all')).not.toBe(
			true
		);
	});
});
