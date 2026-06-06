import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
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

describe('LibraryMemberRow', () => {
	it('renders member display name and email', async () => {
		const screen = renderRow();
		await expect.element(screen.getByText('Alice', { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText('alice@example.com')).toBeInTheDocument();
	});

	it('shows owner badge for owner role', async () => {
		const screen = renderRow({ member: createMember({ role: 'owner' }) });
		const badge = screen.container.querySelector('.badge');
		expect(badge?.textContent?.trim()).toBe('owner');
	});

	it('does not show role select for owner role', async () => {
		const screen = renderRow({ member: createMember({ role: 'owner' }) });
		expect(screen.container.querySelector('select')).toBeNull();
	});

	it('shows role select with the given options for non-owner roles', async () => {
		const screen = renderRow();
		const select = screen.container.querySelector('select');
		expect(select).not.toBeNull();
		const options = select!.querySelectorAll('option');
		expect(options).toHaveLength(2);
		expect(options[0]!.textContent).toBe('Admin');
		expect(options[1]!.textContent).toBe('Viewer');
	});

	it('reflects roleDraft as the selected value', async () => {
		const screen = renderRow({ roleDraft: 'viewer' });
		const select = screen.container.querySelector('select')!;
		expect(select.value).toBe('viewer');
	});

	it('calls onupdateRole when the role select changes', async () => {
		const onupdateRole = vi.fn();
		const member = createMember();
		const screen = renderRow({ member, onupdateRole });
		const select = screen.container.querySelector('select')!;
		select.value = 'viewer';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onupdateRole).toHaveBeenCalledWith(member, 'viewer');
	});

	it('disables role select when updatingRole is true', async () => {
		const screen = renderRow({ updatingRole: true });
		const select = screen.container.querySelector('select')!;
		expect(select.disabled).toBe(true);
	});

	it('does not render the remove button for owners', async () => {
		const screen = renderRow({ member: createMember({ role: 'owner' }) });
		expect(screen.container.querySelector('button')).toBeNull();
	});

	it('calls onremove when the remove button is clicked', async () => {
		const onremove = vi.fn();
		const member = createMember();
		const screen = renderRow({ member, onremove });
		const button = screen.container.querySelector('button')!;
		button.click();
		expect(onremove).toHaveBeenCalledWith(member);
	});

	it('disables the remove button when removing is true', async () => {
		const screen = renderRow({ removing: true });
		const button = screen.container.querySelector('button')!;
		expect(button.disabled).toBe(true);
	});

	it('shows a spinner on the remove button when removing', async () => {
		const screen = renderRow({ removing: true });
		const spinner = screen.container.querySelector('button .animate-spin');
		expect(spinner).not.toBeNull();
	});

	it('does not show a spinner when not removing', async () => {
		const screen = renderRow({ removing: false });
		const spinner = screen.container.querySelector('button .animate-spin');
		expect(spinner).toBeNull();
	});
});
