import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryFile } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
const pageState = vi.hoisted(() => ({
	params: { id: 'lib-1', fileId: 'file-1' } as Record<string, string>,
	url: new URL('http://localhost/libraries/lib-1/doc/file-1'),
	data: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page: pageState }));

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto, invalidateAll: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: true }));

// ─── api mock (page fetches the file record on mount) ────────────────────────
const fileGet = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', () => ({
	api: { files: { get: fileGet } },
	apiUrl: (p: string) => p,
	ApiError: class extends Error {}
}));

// ─── auth/theme mocks ────────────────────────────────────────────────────────
vi.mock('$lib/state/auth.svelte', () => ({
	auth: { user: { id: 'u1', displayName: 'Rusty' } }
}));
vi.mock('$lib/state/theme.svelte', () => ({ theme: { resolved: 'light' } }));

// ─── provider mock — a controllable plain object; tests preset its fields ───
const providerState = vi.hoisted(() => {
	const state = {
		loaded: true,
		role: 'editor' as 'editor' | 'viewer',
		peers: [] as unknown[],
		statusLabel: 'All changes saved',
		contentVersion: 1,
		pendingCount: 0,
		connected: true,
		online: true,
		loadError: null as string | null,
		ytext: { toString: () => '# Hello from the doc' },
		awareness: {},
		load: vi.fn(async () => {}),
		dispose: vi.fn(),
		reset() {
			state.loaded = true;
			state.role = 'editor';
			state.peers = [];
			state.statusLabel = 'All changes saved';
			state.loadError = null;
			state.load.mockClear();
			state.dispose.mockClear();
		}
	};
	return state;
});
vi.mock('$lib/collab/doc-provider.svelte', () => ({
	createDocProvider: () => providerState
}));

// The real MarkdownEditor dynamic-imports CodeMirror and needs a real Y.Text.
vi.mock('$lib/components/doc/MarkdownEditor.svelte', async () => ({
	default: (await import('./MarkdownEditorMock.svelte')).default
}));

import DocPage from './+page@(app).svelte';

const file = { id: 'file-1', name: 'trip-notes.md', mimeType: 'text/markdown' } as LibraryFile;

beforeEach(() => {
	providerState.reset();
	goto.mockClear();
	fileGet.mockReset();
	fileGet.mockResolvedValue(file);
	pageState.url = new URL('http://localhost/libraries/lib-1/doc/file-1');
});

async function settle() {
	await tick();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
}

describe('doc editor page', () => {
	it('loads the provider and renders the editor for editors', async () => {
		const screen = render(DocPage);
		await settle();
		expect(providerState.load).toHaveBeenCalledTimes(1);
		expect(screen.container.querySelector('[data-testid="markdown-editor-mock"]')).toBeTruthy();
		expect(
			screen.container
				.querySelector('[data-testid="markdown-editor-mock"]')
				?.getAttribute('data-readonly')
		).toBe('false');
		expect(screen.container.textContent).toContain('trip-notes.md');
		expect(screen.container.textContent).toContain('All changes saved');
	});

	it('switches between edit, split, and preview modes', async () => {
		const screen = render(DocPage);
		await settle();
		const buttons = [...screen.container.querySelectorAll('[role="group"] button')];
		const byLabel = (label: string) =>
			buttons.find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

		byLabel('Preview').click();
		await settle();
		expect(screen.container.querySelector('[data-testid="markdown-editor-mock"]')).toBeNull();
		expect(screen.container.querySelector('[data-testid="markdown-preview"]')).toBeTruthy();

		byLabel('Split').click();
		await settle();
		expect(screen.container.querySelector('[data-testid="markdown-editor-mock"]')).toBeTruthy();
		expect(screen.container.querySelector('[data-testid="markdown-preview"]')).toBeTruthy();
	});

	it('defaults viewers to preview with a read-only source pane', async () => {
		providerState.role = 'viewer';
		providerState.statusLabel = 'Read-only';
		const screen = render(DocPage);
		await settle();
		// Viewer default is the rendered preview…
		expect(screen.container.querySelector('[data-testid="markdown-preview"]')).toBeTruthy();
		expect(screen.container.querySelector('[data-testid="markdown-editor-mock"]')).toBeNull();
		// …and the source pane is read-only when opened.
		const source = [...screen.container.querySelectorAll('[role="group"] button')].find(
			(b) => b.textContent?.trim() === 'Source'
		) as HTMLButtonElement;
		source.click();
		await settle();
		expect(
			screen.container
				.querySelector('[data-testid="markdown-editor-mock"]')
				?.getAttribute('data-readonly')
		).toBe('true');
	});

	it('renders the failure state when the provider load errors', async () => {
		providerState.loaded = false;
		providerState.loadError = 'boom';
		const screen = render(DocPage);
		await settle();
		expect(screen.container.querySelector('[data-testid="doc-error"]')?.textContent).toContain(
			'boom'
		);
		expect(screen.container.querySelector('[data-testid="markdown-editor-mock"]')).toBeNull();
	});

	it('goes back to the originating folder via ?from=', async () => {
		pageState.url = new URL('http://localhost/libraries/lib-1/doc/file-1?from=folder-9');
		const screen = render(DocPage);
		await settle();
		const back = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Back')
		) as HTMLButtonElement;
		back.click();
		expect(goto).toHaveBeenCalledWith('/libraries/lib-1?folder=folder-9');
	});

	it('disposes the provider on unmount', async () => {
		const screen = render(DocPage);
		await settle();
		screen.unmount();
		expect(providerState.dispose).toHaveBeenCalled();
	});
});
