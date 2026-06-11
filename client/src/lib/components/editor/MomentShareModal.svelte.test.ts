import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import MomentShareModal from './MomentShareModal.svelte';
import type { MomentShare } from '$lib/types/api';

const mocks = vi.hoisted(() => ({
	listShares: vi.fn(),
	createShare: vi.fn(),
	revokeShare: vi.fn(),
	toastAdd: vi.fn()
}));

vi.mock('$lib/api', () => ({
	api: {
		moments: {
			listShares: (...args: unknown[]) => mocks.listShares(...args),
			createShare: (...args: unknown[]) => mocks.createShare(...args),
			revokeShare: (...args: unknown[]) => mocks.revokeShare(...args)
		}
	}
}));

vi.mock('$lib/state/toast', () => ({
	toast: { add: (...args: unknown[]) => mocks.toastAdd(...args) }
}));

function makeShare(over: Partial<MomentShare> = {}): MomentShare {
	return {
		id: 's1',
		momentId: 'm1',
		libraryId: 'lib1',
		token: 'tok1',
		url: 'https://share/tok1',
		revokedAt: null,
		createdAt: '',
		...over
	};
}

const baseProps = {
	open: true,
	libraryId: 'lib1',
	fileId: 'file1',
	momentId: 'm1',
	sharingEnabled: true
};

// The AppModal's Skeleton Dialog mounts its content on a macrotask, and refresh
// runs in an effect when open. Wait a real macrotask (not just microtasks) so the
// dialog is open and the resolved listShares promise has rendered.
async function flush() {
	await tick();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
	await Promise.resolve();
	await tick();
}

function body() {
	return document.body.textContent ?? '';
}

function findButton(label: string): HTMLButtonElement | undefined {
	return [...document.body.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(label)
	) as HTMLButtonElement | undefined;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.listShares.mockResolvedValue([]);
	mocks.createShare.mockResolvedValue(makeShare());
	mocks.revokeShare.mockResolvedValue(undefined);
});

describe('MomentShareModal', () => {
	it('loads shares when opened and renders the URLs', async () => {
		mocks.listShares.mockResolvedValue([makeShare()]);
		render(MomentShareModal, { props: baseProps });
		await flush();
		expect(mocks.listShares).toHaveBeenCalledWith('lib1', 'file1', 'm1');
		expect(body()).toContain('https://share/tok1');
	});

	it('shows an empty state when there are no shares', async () => {
		mocks.listShares.mockResolvedValue([]);
		render(MomentShareModal, { props: baseProps });
		await flush();
		expect(body()).toContain('No active share links');
	});

	it('creates a share link and prepends it with a success toast', async () => {
		mocks.listShares.mockResolvedValue([]);
		mocks.createShare.mockResolvedValue(
			makeShare({ id: 's2', token: 'tok2', url: 'https://share/tok2' })
		);
		render(MomentShareModal, { props: baseProps });
		await flush();

		findButton('Create share link')!.click();
		await flush();

		expect(mocks.createShare).toHaveBeenCalledWith('lib1', 'file1', 'm1');
		expect(body()).toContain('https://share/tok2');
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Share link created',
			color: 'success'
		});
	});

	it('toasts an error when share creation fails', async () => {
		mocks.listShares.mockResolvedValue([]);
		mocks.createShare.mockRejectedValue(new Error('boom'));
		render(MomentShareModal, { props: baseProps });
		await flush();

		findButton('Create share link')!.click();
		await flush();

		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Failed to create share link',
			color: 'error'
		});
	});

	it('disables creation when sharing is turned off for the library', async () => {
		mocks.listShares.mockResolvedValue([]);
		render(MomentShareModal, { props: { ...baseProps, sharingEnabled: false } });
		await flush();

		const createBtn = findButton('Create share link')!;
		expect(createBtn.disabled).toBe(true);
		expect(body()).toContain('Sharing is disabled');
	});

	it('revokes a share link and removes it with a toast', async () => {
		mocks.listShares.mockResolvedValue([makeShare()]);
		mocks.revokeShare.mockResolvedValue(undefined);
		render(MomentShareModal, { props: baseProps });
		await flush();

		findButton('Revoke')!.click();
		await flush();

		expect(mocks.revokeShare).toHaveBeenCalledWith('lib1', 'file1', 'm1', 'tok1');
		expect(body()).not.toContain('https://share/tok1');
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Share link revoked',
			color: 'success'
		});
	});

	it('toasts an error when revoke fails', async () => {
		mocks.listShares.mockResolvedValue([makeShare()]);
		mocks.revokeShare.mockRejectedValue(new Error('boom'));
		render(MomentShareModal, { props: baseProps });
		await flush();

		findButton('Revoke')!.click();
		await flush();

		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Failed to revoke', color: 'error' });
	});

	it('copies a share URL to the clipboard with a success toast', async () => {
		mocks.listShares.mockResolvedValue([makeShare()]);
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText },
			configurable: true
		});
		render(MomentShareModal, { props: baseProps });
		await flush();

		const copyBtn = document.body.querySelector<HTMLButtonElement>(
			"button[aria-label='Copy link']"
		)!;
		copyBtn.click();
		await flush();

		expect(writeText).toHaveBeenCalledWith('https://share/tok1');
		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Link copied', color: 'success' });
	});

	it('falls back to an empty list when loading shares fails', async () => {
		mocks.listShares.mockRejectedValue(new Error('boom'));
		render(MomentShareModal, { props: baseProps });
		await flush();
		expect(body()).toContain('No active share links');
	});

	it('does not load shares while closed', async () => {
		render(MomentShareModal, { props: { ...baseProps, open: false } });
		await flush();
		expect(mocks.listShares).not.toHaveBeenCalled();
	});
});
