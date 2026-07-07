import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import MarkdownPreview from './MarkdownPreview.svelte';

// The preview loads marked/DOMPurify in onMount and debounces renders (200ms).
async function waitForRender(container: HTMLElement, timeoutMs = 3000): Promise<void> {
	const start = performance.now();
	for (;;) {
		await tick();
		const target = container.querySelector('[data-testid="markdown-preview"]');
		if (target && target.innerHTML.trim() !== '') return;
		if (performance.now() - start > timeoutMs) throw new Error('preview never rendered');
		await new Promise((r) => setTimeout(r, 50));
	}
}

describe('MarkdownPreview', () => {
	it('renders markdown as HTML', async () => {
		const screen = render(MarkdownPreview, {
			props: {
				getText: () => '# Title\n\nSome **bold** text\n\n- item one\n- item two',
				version: 1
			}
		});
		await waitForRender(screen.container as HTMLElement);
		const root = screen.container.querySelector('[data-testid="markdown-preview"]')!;
		expect(root.querySelector('h1')?.textContent).toBe('Title');
		expect(root.querySelector('strong')?.textContent).toBe('bold');
		expect(root.querySelectorAll('li')).toHaveLength(2);
	});

	it('sanitizes script tags and event handlers out of the output', async () => {
		const screen = render(MarkdownPreview, {
			props: {
				getText: () =>
					'safe text\n\n<script>window.__xss = true<' +
					'/script>\n\n<img src="x" onerror="window.__xss2 = true" />',
				version: 1
			}
		});
		await waitForRender(screen.container as HTMLElement);
		const root = screen.container.querySelector('[data-testid="markdown-preview"]')!;
		expect(root.textContent).toContain('safe text');
		expect(root.querySelector('script')).toBeNull();
		expect(root.innerHTML).not.toContain('onerror');
		expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
		expect((window as unknown as Record<string, unknown>).__xss2).toBeUndefined();
	});

	it('re-renders when version bumps', async () => {
		let text = 'first';
		const screen = render(MarkdownPreview, {
			props: { getText: () => text, version: 1 }
		});
		await waitForRender(screen.container as HTMLElement);
		expect(screen.container.textContent).toContain('first');

		text = 'second';
		screen.rerender({ getText: () => text, version: 2 });
		const start = performance.now();
		for (;;) {
			await new Promise((r) => setTimeout(r, 50));
			if (screen.container.textContent?.includes('second')) break;
			if (performance.now() - start > 3000) throw new Error('never re-rendered');
		}
	});
});
