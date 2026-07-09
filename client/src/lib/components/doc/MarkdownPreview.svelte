<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';

	interface Props {
		/** Getter so the (non-reactive) Y.Text is read lazily. */
		getText: () => string;
		/** Bumped by the provider on every doc change — drives re-renders. */
		version: number;
	}

	let { getText, version }: Props = $props();

	let html = $state('');
	let ready = $state(false);

	// Module handles — dynamic imports keep marked/DOMPurify out of SSR
	// (DOMPurify needs a DOM).
	let marked: typeof import('marked').marked | null = null;
	let purify: typeof import('dompurify').default | null = null;
	let renderTimer: ReturnType<typeof setTimeout> | null = null;

	function render() {
		if (!marked || !purify) return;
		// Sanitization is non-negotiable: collaborative markdown can embed raw
		// HTML, so everything goes through DOMPurify before {@html}.
		const raw = marked.parse(getText(), { async: false }) as string;
		html = purify.sanitize(raw);
	}

	function scheduleRender() {
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = setTimeout(render, 200);
	}

	onMount(async () => {
		if (!browser) return;
		const [markedMod, dompurifyMod] = await Promise.all([import('marked'), import('dompurify')]);
		marked = markedMod.marked;
		purify = dompurifyMod.default;
		ready = true;
		render();
	});

	$effect(() => {
		void version; // re-render on every doc change (debounced)
		if (ready) scheduleRender();
	});

	onDestroy(() => {
		if (renderTimer) clearTimeout(renderTimer);
	});
</script>

<div class="doc-prose h-full min-h-0 overflow-y-auto px-6 py-4" data-testid="markdown-preview">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via DOMPurify above -->
	{@html html}
</div>

<style>
	.doc-prose {
		color: var(--color-foreground);
		line-height: 1.65;
		word-wrap: break-word;
	}
	.doc-prose :global(h1) {
		font-size: 1.6em;
		font-weight: 700;
		margin: 1rem 0 0.5rem;
	}
	.doc-prose :global(h2) {
		font-size: 1.3em;
		font-weight: 700;
		margin: 1rem 0 0.5rem;
	}
	.doc-prose :global(h3) {
		font-size: 1.15em;
		font-weight: 600;
		margin: 0.75rem 0 0.4rem;
	}
	.doc-prose :global(h4),
	.doc-prose :global(h5),
	.doc-prose :global(h6) {
		font-weight: 600;
		margin: 0.75rem 0 0.4rem;
	}
	.doc-prose :global(p) {
		margin: 0.5rem 0;
	}
	.doc-prose :global(ul),
	.doc-prose :global(ol) {
		margin: 0.5rem 0;
		padding-left: 1.5rem;
	}
	.doc-prose :global(ul) {
		list-style: disc;
	}
	.doc-prose :global(ol) {
		list-style: decimal;
	}
	.doc-prose :global(li) {
		margin: 0.2rem 0;
	}
	.doc-prose :global(input[type='checkbox']) {
		margin-right: 0.4rem;
	}
	.doc-prose :global(blockquote) {
		border-left: 3px solid var(--color-border);
		color: var(--color-muted-foreground);
		padding-left: 0.9rem;
		margin: 0.6rem 0;
		font-style: italic;
	}
	.doc-prose :global(code) {
		background: var(--color-muted);
		border-radius: 0.25rem;
		padding: 0.1rem 0.35rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.88em;
	}
	.doc-prose :global(pre) {
		background: var(--color-muted);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		overflow-x: auto;
		margin: 0.6rem 0;
	}
	.doc-prose :global(pre code) {
		background: transparent;
		padding: 0;
	}
	.doc-prose :global(a) {
		color: var(--color-primary);
		text-decoration: underline;
	}
	.doc-prose :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-border);
		margin: 1rem 0;
	}
	.doc-prose :global(table) {
		border-collapse: collapse;
		margin: 0.6rem 0;
		width: 100%;
	}
	.doc-prose :global(th),
	.doc-prose :global(td) {
		border: 1px solid var(--color-border);
		padding: 0.35rem 0.6rem;
		text-align: left;
	}
	.doc-prose :global(th) {
		background: var(--color-muted);
		font-weight: 600;
	}
	.doc-prose :global(img) {
		max-width: 100%;
	}
</style>
