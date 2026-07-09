import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from '@vitest/browser/context';
import { tick } from 'svelte';
import LibraryMemberRow from './LibraryMemberRow.svelte';
import type { LibraryMemberWithUser } from '$lib/types/api';

const roleOptions = [
	{ label: 'Admin', value: 'admin' as const },
	{ label: 'Viewer', value: 'viewer' as const }
];

function createMember(overrides: Partial<LibraryMemberWithUser> = {}): LibraryMemberWithUser {
	return {
		id: 'mem-1',
		userId: 'u-1',
		role: 'admin',
		isOwner: false,
		createdAt: '2024-01-01T00:00:00Z',
		user: {
			id: 'u-1',
			email: 'alice@example.com',
			displayName: 'Alice',
			avatarUrl: null
		},
		...overrides
	};
}

function renderRow(props: Partial<Record<string, unknown>> = {}) {
	return render(LibraryMemberRow, {
		props: {
			member: createMember(),
			roleDraft: 'admin' as const,
			updatingRole: false,
			removing: false,
			roleOptions,
			...props
		}
	});
}

// bits-ui's Select.Content is portalled to `document.body` and opens on
// `pointerdown`, not `click` — see the same idiom in
// routes/(app)/admin/page.svelte.test.ts.
async function chooseRole(trigger: HTMLElement, optionText: string) {
	await userEvent.click(trigger);
	await tick();
	const item = [...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')].find(
		(el) => el.textContent?.trim() === optionText
	);
	expect(item).toBeDefined();
	await userEvent.click(item!);
	await tick();
}

describe('LibraryMemberRow', () => {
	it('renders member display name and email', async () => {
		const screen = renderRow();
		await expect.element(screen.getByText('Alice', { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText('alice@example.com')).toBeInTheDocument();
	});

	it('shows owner badge for owner role', async () => {
		const screen = renderRow({ member: createMember({ role: 'owner' }) });
		const badge = screen.container.querySelector('[data-slot="badge"]');
		expect(badge?.textContent?.trim()).toBe('owner');
	});

	it('does not show a role select for owner role', async () => {
		const screen = renderRow({ member: createMember({ role: 'owner' }) });
		expect(screen.container.querySelector('[data-slot="select-trigger"]')).toBeNull();
	});

	it('shows a role select trigger for non-owner roles', async () => {
		const screen = renderRow();
		const trigger = screen.container.querySelector('[data-slot="select-trigger"]');
		expect(trigger).not.toBeNull();
	});

	it('reflects roleDraft as the trigger label', async () => {
		const screen = renderRow({ roleDraft: 'viewer' });
		const trigger = screen.container.querySelector('[data-slot="select-trigger"]');
		expect(trigger?.textContent?.trim()).toBe('Viewer');
	});

	it('calls onupdateRole with the chosen role when a select item is picked', async () => {
		const onupdateRole = vi.fn();
		const member = createMember();
		const screen = renderRow({ member, onupdateRole });
		const trigger = screen.container.querySelector<HTMLElement>('[data-slot="select-trigger"]')!;
		await chooseRole(trigger, 'Viewer');
		expect(onupdateRole).toHaveBeenCalledWith(member, 'viewer');
	});

	it('disables the role select trigger when updatingRole is true', async () => {
		const screen = renderRow({ updatingRole: true });
		const trigger = screen.container.querySelector<HTMLButtonElement>(
			'[data-slot="select-trigger"]'
		)!;
		expect(trigger.disabled).toBe(true);
	});

	it('does not render the remove button for owners', async () => {
		const screen = renderRow({ member: createMember({ role: 'owner' }) });
		expect(screen.container.querySelector('button')).toBeNull();
	});

	it('calls onremove when the remove button is clicked', async () => {
		const onremove = vi.fn();
		const member = createMember();
		const screen = renderRow({ member, onremove });
		const button = screen.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Remove member"]'
		)!;
		button.click();
		expect(onremove).toHaveBeenCalledWith(member);
	});

	it('disables the remove button when removing is true', async () => {
		const screen = renderRow({ removing: true });
		const button = screen.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Remove member"]'
		)!;
		expect(button.disabled).toBe(true);
	});

	it('shows a spinner on the remove button when removing', async () => {
		const screen = renderRow({ removing: true });
		const spinner = screen.container.querySelector(
			'button[aria-label="Remove member"] .animate-spin'
		);
		expect(spinner).not.toBeNull();
	});

	it('does not show a spinner when not removing', async () => {
		const screen = renderRow({ removing: false });
		const spinner = screen.container.querySelector(
			'button[aria-label="Remove member"] .animate-spin'
		);
		expect(spinner).toBeNull();
	});
});
