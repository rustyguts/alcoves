import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { userEvent } from '@vitest/browser/context';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
	stats: {
		users: 2,
		libraries: 3,
		files: 100,
		folders: 8,
		totalSize: 1024 * 1024 * 500
	},
	users: [
		{
			id: 'user-1',
			email: 'owner@example.com',
			displayName: 'Owner User',
			avatarUrl: null,
			role: 'owner' as const,
			createdAt: '2025-01-01T00:00:00Z',
			updatedAt: '2025-01-01T00:00:00Z'
		},
		{
			id: 'user-2',
			email: 'member@example.com',
			displayName: 'Member User',
			avatarUrl: null,
			role: 'member' as const,
			createdAt: '2025-02-01T00:00:00Z',
			updatedAt: '2025-02-01T00:00:00Z'
		}
	],
	settings: {
		registration_mode: 'open',
		whisper_model: 'large-v3',
		whisper_language: 'auto',
		audio_detect_model: 'efficientat_mn10'
	},
	stat: vi.fn(),
	listUsers: vi.fn(),
	updateUserRole: vi.fn(),
	getSettings: vi.fn(),
	updateSettings: vi.fn(),
	toastAdd: vi.fn()
}));

// The page's current user is read from page.data.user (the authed shell's
// server load). user-1 is the signed-in owner — its role select is disabled.
vi.mock('$app/state', () => ({
	page: {
		params: {},
		url: new URL('http://localhost/admin'),
		data: { user: { id: 'user-1', role: 'owner' } }
	}
}));

vi.mock('$lib/api', () => ({
	api: {
		admin: {
			stats: mocks.stat,
			listUsers: mocks.listUsers,
			updateUserRole: mocks.updateUserRole,
			getSettings: mocks.getSettings,
			updateSettings: mocks.updateSettings,
			controlJob: vi.fn().mockResolvedValue(undefined),
			purgeQueue: vi.fn().mockResolvedValue({ total: 0 })
		}
	},
	apiUrl: (path: string) => path,
	ApiError: class ApiError extends Error {}
}));

vi.mock('$lib/state/toast', () => ({
	toast: { add: mocks.toastAdd }
}));

// AdminJobsPanel opens an SSE stream on mount — provide a no-op EventSource so
// the embedded panel mounts cleanly inside the page under test.
class MockEventSource {
	url: string;
	onopen: ((e: Event) => void) | null = null;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;
	constructor(url: string) {
		this.url = url;
	}
	close() {}
}
vi.stubGlobal('EventSource', MockEventSource);

// The version footer is fetched with raw fetch(apiUrl('/api/version')).
const versionPayload = {
	commit: '75c26d8d76c45f29e302b590ed94f4172dfb538f',
	buildTime: '2026-04-27T06:37:47Z',
	dirty: false,
	mode: 'all'
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.stat.mockResolvedValue(mocks.stats);
	mocks.listUsers.mockResolvedValue(mocks.users);
	mocks.getSettings.mockResolvedValue({ ...mocks.settings });
	mocks.updateUserRole.mockResolvedValue({ id: 'user-2', role: 'owner' });
	mocks.updateSettings.mockImplementation(async (body: Record<string, unknown>) => ({
		...mocks.settings,
		...body
	}));
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			json: async () => versionPayload
		})
	);
});

/** Render + let onMount's async loaders resolve. */
async function renderPage() {
	const screen = render(Page);
	// Flush the onMount promises (stats/users/settings/version).
	await vi.waitFor(() => {
		expect(screen.container.textContent).toContain('100');
	});
	await tick();
	return screen;
}

/**
 * Render for the failure paths where the stats loader rejects (so the '100'
 * sentinel never appears). The heading is always present, and we still need a
 * tick for the rejected onMount promises to settle their $state writes.
 */
async function renderPageDegraded() {
	const screen = render(Page);
	await vi.waitFor(() => {
		expect(screen.container.textContent).toContain('Admin Dashboard');
	});
	await tick();
	await tick();
	return screen;
}

/** All radio items (bits-ui RadioGroup.Item renders role="radio" + data-value). */
function radioItem(value: string) {
	return document.querySelector<HTMLButtonElement>(`[role="radio"][data-value="${value}"]`);
}

/**
 * Select triggers are buttons (`data-slot="select-trigger"`), one per Select.Root
 * on the page. bits-ui opens/selects on `pointerdown`/`pointerup` (not `click`),
 * so a plain DOM `.click()` doesn't work here — use the Playwright-backed
 * `userEvent` (real pointer events) instead. Since Select.Content is portalled
 * to `document.body`, pick the option by its visible text from the (single,
 * currently-open) portalled listbox.
 */
async function chooseSelect(trigger: HTMLButtonElement, optionText: string) {
	await userEvent.click(trigger);
	await tick();
	const item = [...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')].find(
		(el) => el.textContent?.trim() === optionText
	);
	expect(item).toBeDefined();
	await userEvent.click(item!);
	await tick();
}

function selectTriggers(screen: Awaited<ReturnType<typeof render>>) {
	return [...screen.container.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]')];
}

function selectTriggerByLabel(
	screen: Awaited<ReturnType<typeof render>>,
	label: string
): HTMLButtonElement {
	return selectTriggers(screen).find((t) => t.getAttribute('aria-label') === label)!;
}

describe('/admin page', () => {
	it('renders the admin heading and subtitle', async () => {
		const screen = await renderPage();
		expect(screen.container.textContent).toContain('Admin Dashboard');
		expect(screen.container.textContent).toContain(
			'Instance overview, user management, and background jobs.'
		);
	});

	it('renders the stat cards from api.admin.stats', async () => {
		const screen = await renderPage();
		const text = screen.container.textContent ?? '';
		expect(text).toContain('Files');
		expect(text).toContain('100');
		expect(text).toContain('Storage');
		expect(text).toContain('500 MB');
		expect(text).toContain('Libraries');
		expect(text).toContain('Users');
		expect(text).toContain('Folders');
		expect(text).toContain('8');
	});

	it('lists users from api.admin.listUsers with column headers', async () => {
		const screen = await renderPage();
		const text = screen.container.textContent ?? '';
		expect(text).toContain('Owner User');
		expect(text).toContain('owner@example.com');
		expect(text).toContain('Member User');
		expect(text).toContain('Joined');
		expect(text).toContain('Updated');
	});

	it('disables the role select for the signed-in user but enables it for others', async () => {
		const screen = await renderPage();
		const ownerTrigger = selectTriggerByLabel(screen, 'Change role for Owner User');
		const memberTrigger = selectTriggerByLabel(screen, 'Change role for Member User');
		expect(ownerTrigger.disabled).toBe(true); // current user (user-1)
		expect(memberTrigger.disabled).toBe(false); // other user (user-2)
	});

	it('updates a user role through api.admin.updateUserRole', async () => {
		const screen = await renderPage();
		const memberTrigger = selectTriggerByLabel(screen, 'Change role for Member User');
		await chooseSelect(memberTrigger, 'Owner');
		await vi.waitFor(() => {
			expect(mocks.updateUserRole).toHaveBeenCalledWith('user-2', { role: 'owner' });
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Role updated', color: 'success' });
	});

	it('renders the registration mode radios reflecting the loaded setting', async () => {
		await renderPage();
		const openRadio = radioItem('open');
		expect(openRadio).not.toBeNull();
		expect(openRadio?.getAttribute('aria-checked')).toBe('true');
	});

	it('updates the registration mode via a radio change', async () => {
		await renderPage();
		radioItem('invite_only')?.click();
		await vi.waitFor(() => {
			expect(mocks.updateSettings).toHaveBeenCalledWith({ registration_mode: 'invite_only' });
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Registration mode updated',
			color: 'success'
		});
	});

	it('renders the selected whisper model details', async () => {
		const screen = await renderPage();
		// large-v3 is the default; its notes string should be visible.
		expect(screen.container.textContent).toContain('Best WER');
	});

	it('updates the whisper model via the select', async () => {
		const screen = await renderPage();
		const trigger = selectTriggerByLabel(screen, 'Transcription model');
		await chooseSelect(trigger, 'tiny');
		await vi.waitFor(() => {
			expect(mocks.updateSettings).toHaveBeenCalledWith({ whisper_model: 'tiny' });
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Transcription model: tiny',
			color: 'success'
		});
	});

	it('marks unavailable audio taggers as disabled options', async () => {
		const screen = await renderPage();
		const trigger = selectTriggerByLabel(screen, 'Audio tagger');
		await userEvent.click(trigger);
		await tick();
		const items = [...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')];
		const cedSmall = items.find((el) => el.textContent?.includes('CED-Small'));
		const pann = items.find((el) => el.textContent?.includes('PANNs CNN14'));
		expect(cedSmall?.hasAttribute('data-disabled')).toBe(true);
		expect(pann?.hasAttribute('data-disabled')).toBe(false);
	});

	it('rolls back and toasts on a settings update failure', async () => {
		await renderPage();
		mocks.updateSettings.mockRejectedValueOnce(new Error('server boom'));
		radioItem('closed')?.click();
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'server boom', color: 'error' });
		});
	});

	// F3 regression (.agents/specs/shadcn-rewrite/07-rework-findings.md): a
	// failed PATCH used to leave the RadioGroup showing the rejected mode
	// (via bits-ui's unbound-bindable local override) AND made re-clicking
	// that same mode inert (bits-ui's same-value guard never saw a change).
	it('shows the true server state and allows a retry after a registration-mode failure', async () => {
		await renderPage();
		mocks.updateSettings.mockRejectedValueOnce(new Error('server boom'));
		radioItem('closed')?.click();
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'server boom', color: 'error' });
		});
		// The radio must re-sync to the real (unchanged) server state, not the
		// rejected selection.
		await vi.waitFor(() => {
			expect(radioItem('open')?.getAttribute('aria-checked')).toBe('true');
		});
		expect(radioItem('closed')?.getAttribute('aria-checked')).toBe('false');

		// Re-clicking the previously-rejected mode must retry the API call, not
		// be swallowed by bits-ui's "already selected" guard.
		mocks.toastAdd.mockClear();
		radioItem('closed')?.click();
		await vi.waitFor(() => {
			expect(mocks.updateSettings).toHaveBeenCalledWith({ registration_mode: 'closed' });
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Registration mode updated',
			color: 'success'
		});
	});

	// Same one-way `value` desync as F3, audited on the adjacent Select
	// controls: the Trigger label self-heals (it's derived from `settings`
	// separately), but the Select's own internal selection must also re-sync
	// or a retry pick is silently swallowed.
	it('re-syncs the select and allows a retry after a whisper-model update failure', async () => {
		const screen = await renderPage();
		mocks.updateSettings.mockRejectedValueOnce(new Error('model failed'));
		const trigger = selectTriggerByLabel(screen, 'Transcription model');
		await chooseSelect(trigger, 'tiny');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'model failed', color: 'error' });
		});

		mocks.toastAdd.mockClear();
		await chooseSelect(trigger, 'tiny');
		await vi.waitFor(() => {
			expect(mocks.updateSettings).toHaveBeenCalledWith({ whisper_model: 'tiny' });
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Transcription model: tiny',
			color: 'success'
		});
	});

	// Same class of fix applied to the per-row role Select, replacing the
	// previous "reassign the array" trick that didn't reliably resync a
	// single row's Select value.
	it('re-syncs the role select and allows a retry after a role-update failure', async () => {
		const screen = await renderPage();
		mocks.updateUserRole.mockRejectedValueOnce(new Error('role denied'));
		const memberTrigger = selectTriggerByLabel(screen, 'Change role for Member User');
		await chooseSelect(memberTrigger, 'Owner');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'role denied', color: 'error' });
		});
		expect(memberTrigger.textContent?.trim()).toBe('Member');

		mocks.toastAdd.mockClear();
		mocks.updateUserRole.mockResolvedValueOnce({ id: 'user-2', role: 'owner' });
		await chooseSelect(memberTrigger, 'Owner');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'Role updated', color: 'success' });
		});
		expect(mocks.updateUserRole).toHaveBeenCalledWith('user-2', { role: 'owner' });
	});

	it('renders the version footer linking to the GitHub commit', async () => {
		const screen = await renderPage();
		await vi.waitFor(() => {
			const link = screen.container.querySelector(
				'a[href*="github.com/rustyguts/alcoves/commit/"]'
			);
			expect(link).not.toBeNull();
		});
		const link = screen.container.querySelector(
			'a[href*="github.com/rustyguts/alcoves/commit/"]'
		) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe(
			'https://github.com/rustyguts/alcoves/commit/75c26d8d76c45f29e302b590ed94f4172dfb538f'
		);
		// Short SHA (first 7 chars), not the full hash.
		expect(link.textContent?.trim()).toBe('75c26d8');
	});

	it('renders "—" placeholders and no version footer when loaders fail', async () => {
		mocks.stat.mockRejectedValueOnce(new Error('stats down'));
		mocks.getSettings.mockRejectedValueOnce(new Error('settings down'));
		// Version fetch rejects → versionInfo stays null → footer hidden.
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
		const screen = await renderPageDegraded();
		const text = screen.container.textContent ?? '';
		// Stat cards fall back to em-dash when stats is null.
		expect(text).toContain('—');
		// No commit link in the footer when version load failed.
		expect(
			screen.container.querySelector('a[href*="github.com/rustyguts/alcoves/commit/"]')
		).toBeNull();
	});

	it('shows the empty state when there are no users', async () => {
		mocks.listUsers.mockResolvedValueOnce([]);
		const screen = await renderPage();
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('No users found');
		});
		// A genuinely-empty list is distinct from a failed load: no error copy.
		expect(screen.container.textContent).not.toContain("Couldn't load users");
	});

	it('shows a distinct error state when listUsers rejects', async () => {
		mocks.listUsers.mockRejectedValueOnce(new Error('boom'));
		const screen = await renderPage();
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain("Couldn't load users");
		});
		// A load error must NOT masquerade as an empty result.
		expect(screen.container.textContent).not.toContain('No users found');
	});

	it('rolls back the user list and toasts on a role-update failure', async () => {
		const screen = await renderPage();
		mocks.updateUserRole.mockRejectedValueOnce(new Error('role denied'));
		const memberTrigger = selectTriggerByLabel(screen, 'Change role for Member User');
		await chooseSelect(memberTrigger, 'Owner');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'role denied', color: 'error' });
		});
		expect(mocks.updateUserRole).toHaveBeenCalledWith('user-2', { role: 'owner' });
	});

	it('updates the transcription language via the language select', async () => {
		const screen = await renderPage();
		const trigger = selectTriggerByLabel(screen, 'Transcription language');
		await chooseSelect(trigger, 'French');
		await vi.waitFor(() => {
			expect(mocks.updateSettings).toHaveBeenCalledWith({ whisper_language: 'fr' });
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Transcription language: fr',
			color: 'success'
		});
	});

	it('toasts an error when the language update fails', async () => {
		const screen = await renderPage();
		mocks.updateSettings.mockRejectedValueOnce(new Error('lang failed'));
		const trigger = selectTriggerByLabel(screen, 'Transcription language');
		await chooseSelect(trigger, 'German');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'lang failed', color: 'error' });
		});
	});

	it('updates the audio tagger via the tagger select', async () => {
		const screen = await renderPage();
		const trigger = selectTriggerByLabel(screen, 'Audio tagger');
		await chooseSelect(trigger, 'PANNs CNN14 (legacy)');
		await vi.waitFor(() => {
			expect(mocks.updateSettings).toHaveBeenCalledWith({ audio_detect_model: 'pann_cnn14' });
		});
		expect(mocks.toastAdd).toHaveBeenCalledWith({
			title: 'Audio tagger: pann_cnn14',
			color: 'success'
		});
	});

	it('toasts an error when the audio-tagger update fails', async () => {
		const screen = await renderPage();
		mocks.updateSettings.mockRejectedValueOnce(new Error('tagger failed'));
		const trigger = selectTriggerByLabel(screen, 'Audio tagger');
		await chooseSelect(trigger, 'PANNs CNN14 (legacy)');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'tagger failed', color: 'error' });
		});
	});

	it('toasts an error when the whisper-model update fails', async () => {
		const screen = await renderPage();
		mocks.updateSettings.mockRejectedValueOnce(new Error('model failed'));
		const trigger = selectTriggerByLabel(screen, 'Transcription model');
		await chooseSelect(trigger, 'tiny');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({ title: 'model failed', color: 'error' });
		});
	});

	it('renders the English-only warning for a distil whisper model', async () => {
		mocks.getSettings.mockResolvedValueOnce({
			...mocks.settings,
			whisper_model: 'distil-large-v3.5-q5'
		});
		const screen = await renderPage();
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('English-only');
		});
		// The distil model is small enough that the ≥4 GB callout is absent.
		expect(screen.container.textContent).not.toContain('Needs ≥4 GB RAM');
	});

	it('renders the audio-tagger detail panel for the loaded model', async () => {
		const screen = await renderPage();
		const text = screen.container.textContent ?? '';
		// efficientat_mn10 notes + license + mAP.
		expect(text).toContain('faster on CPU');
		expect(text).toContain('MIT');
		expect(text).toContain('0.471');
	});

	it('uses the fallback message when the rejection is not an Error', async () => {
		const screen = await renderPage();
		// A non-Error rejection (e.g. a string) falls through errorMessage to the
		// supplied fallback string.
		mocks.updateSettings.mockRejectedValueOnce('opaque failure');
		const trigger = selectTriggerByLabel(screen, 'Audio tagger');
		await chooseSelect(trigger, 'PANNs CNN14 (legacy)');
		await vi.waitFor(() => {
			expect(mocks.toastAdd).toHaveBeenCalledWith({
				title: 'Failed to update audio tagger',
				color: 'error'
			});
		});
	});

	it('renders the dirty badge and build-time when the build is dirty', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ ...versionPayload, dirty: true })
			})
		);
		const screen = await renderPage();
		await vi.waitFor(() => {
			expect(screen.container.textContent).toContain('dirty');
		});
		expect(screen.container.textContent).toContain('built');
	});

	it('hides the version footer when the version fetch is non-ok', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				json: async () => versionPayload
			})
		);
		const screen = await renderPage();
		expect(
			screen.container.querySelector('a[href*="github.com/rustyguts/alcoves/commit/"]')
		).toBeNull();
	});

	it('no-ops when selecting the already-active registration mode', async () => {
		await renderPage();
		radioItem('open')?.click();
		await tick();
		// Selecting the current value short-circuits before calling the API.
		expect(mocks.updateSettings).not.toHaveBeenCalled();
	});

	it('no-ops when re-selecting the active whisper model', async () => {
		const screen = await renderPage();
		const trigger = selectTriggerByLabel(screen, 'Transcription model');
		// large-v3 is already active; re-selecting it must not hit the API.
		await chooseSelect(trigger, 'large-v3 (default)');
		expect(mocks.updateSettings).not.toHaveBeenCalled();
	});

	it('no-ops a role change to the same role the user already has', async () => {
		const screen = await renderPage();
		const memberTrigger = selectTriggerByLabel(screen, 'Change role for Member User');
		// user-2 is already a member; re-picking member short-circuits.
		await chooseSelect(memberTrigger, 'Member');
		expect(mocks.updateUserRole).not.toHaveBeenCalled();
	});
});
