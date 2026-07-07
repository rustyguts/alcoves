import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import DocEditorHeader from './DocEditorHeader.svelte';
import type { DocPeer } from '$lib/collab/doc-provider.svelte';
import type { LibraryFile } from '$lib/types/api';

const file = { id: 'f1', name: 'trip-notes.md', mimeType: 'text/markdown' } as LibraryFile;

const peer = (n: number): DocPeer => ({
	clientId: n,
	userId: `user-${n}`,
	name: `Peer ${n}`,
	color: '#ef4444'
});

describe('DocEditorHeader', () => {
	it('renders the file name, status chip, and editor modes', async () => {
		const screen = render(DocEditorHeader, {
			props: {
				file,
				peers: [],
				statusLabel: 'All changes saved',
				canEdit: true,
				mode: 'edit' as const
			}
		});
		await tick();
		expect(screen.container.textContent).toContain('trip-notes.md');
		expect(screen.container.querySelector('[data-testid="doc-status"]')?.textContent).toContain(
			'All changes saved'
		);
		const buttons = [...screen.container.querySelectorAll('[role="group"] button')].map((b) =>
			b.textContent?.trim()
		);
		expect(buttons).toEqual(['Edit', 'Split', 'Preview']);
	});

	it('shows viewer modes with a Source label and read-only status', async () => {
		const screen = render(DocEditorHeader, {
			props: {
				file,
				peers: [],
				statusLabel: 'Read-only',
				canEdit: false,
				mode: 'preview' as const
			}
		});
		await tick();
		const buttons = [...screen.container.querySelectorAll('[role="group"] button')].map((b) =>
			b.textContent?.trim()
		);
		expect(buttons).toEqual(['Preview', 'Source']);
		expect(screen.container.textContent).toContain('Read-only');
	});

	it('emits mode changes and marks the active mode', async () => {
		const onmode = vi.fn();
		const screen = render(DocEditorHeader, {
			props: {
				file,
				peers: [],
				statusLabel: 'All changes saved',
				canEdit: true,
				mode: 'split' as const,
				onmode
			}
		});
		await tick();
		const buttons = [...screen.container.querySelectorAll('[role="group"] button')];
		expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
		(buttons[2] as HTMLButtonElement).click();
		expect(onmode).toHaveBeenCalledWith('preview');
	});

	it('renders presence avatars with an overflow badge', async () => {
		const screen = render(DocEditorHeader, {
			props: {
				file,
				peers: [1, 2, 3, 4, 5, 6].map(peer),
				statusLabel: 'All changes saved',
				canEdit: true,
				mode: 'edit' as const
			}
		});
		await tick();
		const avatars = screen.container.querySelectorAll('[data-testid="doc-peer"]');
		expect(avatars).toHaveLength(4);
		expect(screen.container.textContent).toContain('+2');
	});

	it('invokes onback', async () => {
		const onback = vi.fn();
		const screen = render(DocEditorHeader, {
			props: {
				file,
				peers: [],
				statusLabel: 'Saving…',
				canEdit: true,
				mode: 'edit' as const,
				onback
			}
		});
		await tick();
		const back = [...screen.container.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Back')
		);
		(back as HTMLButtonElement).click();
		expect(onback).toHaveBeenCalled();
	});
});
