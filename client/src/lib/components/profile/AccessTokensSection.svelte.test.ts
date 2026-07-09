import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import AccessTokensSection from './AccessTokensSection.svelte';

const mocks = vi.hoisted(() => ({
	listTokens: vi.fn(),
	createToken: vi.fn(),
	revokeToken: vi.fn(),
	toastAdd: vi.fn()
}));

vi.mock('$lib/api', () => ({
	api: {
		auth: {
			listTokens: (...args: unknown[]) => mocks.listTokens(...args),
			createToken: (...args: unknown[]) => mocks.createToken(...args),
			revokeToken: (...args: unknown[]) => mocks.revokeToken(...args)
		}
	}
}));

vi.mock('$lib/state/toast', () => ({
	toast: { add: (...args: unknown[]) => mocks.toastAdd(...args) }
}));

const existingToken = {
	id: 't1',
	name: 'laptop',
	lastUsedAt: null,
	expiresAt: null,
	createdAt: '2026-01-01T00:00:00Z'
};

// The list loads in onMount; flush the resolved promise + the resulting render.
async function flush() {
	await tick();
	await Promise.resolve();
	await tick();
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.listTokens.mockResolvedValue([existingToken]);
	mocks.createToken.mockResolvedValue({
		id: 'new',
		name: 'ci',
		token: 'alc_pat_SECRETVALUE',
		lastUsedAt: null,
		expiresAt: null,
		createdAt: '2026-06-01T00:00:00Z'
	});
	mocks.revokeToken.mockResolvedValue(undefined);
});

describe('AccessTokensSection', () => {
	it('renders the heading and existing tokens with a count badge', async () => {
		const screen = render(AccessTokensSection);
		await flush();
		await expect.element(screen.getByText('MCP access tokens')).toBeInTheDocument();
		await expect.element(screen.getByText('laptop')).toBeInTheDocument();
		await expect.element(screen.getByText('1 active')).toBeInTheDocument();
	});

	it('shows an empty state when there are no tokens', async () => {
		mocks.listTokens.mockResolvedValue([]);
		const screen = render(AccessTokensSection);
		await flush();
		await expect.element(screen.getByText('No access tokens yet')).toBeInTheDocument();
	});

	it('creates a token with a trimmed name and refreshes the list', async () => {
		const screen = render(AccessTokensSection);
		await flush();

		const input = screen.container.querySelector<HTMLInputElement>(
			'input[placeholder="e.g. Claude Desktop on laptop"]'
		)!;
		input.value = '  ci  ';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		const createBtn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Create token')
		)!;
		createBtn.click();
		await flush();

		// Name is trimmed; "never" expiry maps to null.
		expect(mocks.createToken).toHaveBeenCalledWith({ name: 'ci', expiresInDays: null });
		// refresh re-lists after create, and the create succeeds (no error toast).
		expect(mocks.listTokens).toHaveBeenCalledTimes(2);
		expect(mocks.toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
		// The name field is cleared after a successful create.
		await expect.poll(() => input.value).toBe('');
	});

	it('surfaces a server error message when creation fails', async () => {
		mocks.createToken.mockRejectedValue({ data: { message: 'name already taken' } });
		const screen = render(AccessTokensSection);
		await flush();

		const input = screen.container.querySelector<HTMLInputElement>(
			'input[placeholder="e.g. Claude Desktop on laptop"]'
		)!;
		input.value = 'ci';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		const createBtn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Create token')
		)!;
		createBtn.click();
		await flush();

		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'name already taken', color: 'error' });
	});

	it('maps an expiry selection to days when creating', async () => {
		const screen = render(AccessTokensSection);
		await flush();

		const input = screen.container.querySelector<HTMLInputElement>(
			'input[placeholder="e.g. Claude Desktop on laptop"]'
		)!;
		input.value = 'ci';
		input.dispatchEvent(new Event('input', { bubbles: true }));

		// bits-ui's Select trigger is a plain button (aria-haspopup=listbox) that
		// opens a portalled listbox — open it and pick the option via real locator
		// clicks (raw DOM .click() doesn't fire the pointerdown/up sequence the
		// primitive listens for).
		await screen.getByRole('button', { name: 'Expires' }).click();
		await screen.getByRole('option', { name: '90 days' }).click();
		await tick();

		const createBtn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Create token')
		)!;
		createBtn.click();
		await flush();

		expect(mocks.createToken).toHaveBeenCalledWith({ name: 'ci', expiresInDays: 90 });
	});

	it('requires a name before creating and toasts an error', async () => {
		const screen = render(AccessTokensSection);
		await flush();

		const createBtn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Create token')
		)!;
		createBtn.click();
		await flush();

		expect(mocks.createToken).not.toHaveBeenCalled();
		expect(mocks.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
	});

	it('revokes a token and refreshes the list', async () => {
		const screen = render(AccessTokensSection);
		await flush();

		const revokeBtn = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Revoke')
		)!;
		revokeBtn.click();
		await flush();

		expect(mocks.revokeToken).toHaveBeenCalledWith('t1');
		expect(mocks.listTokens).toHaveBeenCalledTimes(2);
		expect(mocks.toastAdd).toHaveBeenCalledWith(
			expect.objectContaining({ color: 'success', title: 'Token revoked' })
		);
	});
});
