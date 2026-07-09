<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	// Types only — the runtime modules are dynamically imported inside onMount
	// (LibraryMap pattern) so CodeMirror never runs during SSR. The instances
	// live in plain lets, NEVER $state: Svelte 5 deep proxies corrupt CM/Yjs
	// internals.
	import type * as Y from 'yjs';
	import type { Awareness } from 'y-protocols/awareness';
	import type { EditorView } from '@codemirror/view';
	import type { Compartment, Extension } from '@codemirror/state';

	interface Props {
		ytext: Y.Text;
		awareness: Awareness;
		readonly?: boolean;
		dark?: boolean;
	}

	let { ytext, awareness, readonly = false, dark = false }: Props = $props();

	let editorEl: HTMLElement | null = $state(null);
	let ready = $state(false);

	let view: EditorView | null = null;
	let themeCompartment: Compartment | null = null;
	let buildTheme: ((isDark: boolean) => Extension) | null = null;

	onMount(async () => {
		if (!browser || !editorEl) return;

		const [
			{ EditorView: EV, keymap },
			{ EditorState, Compartment },
			{ defaultKeymap, indentWithTab },
			{ syntaxHighlighting, HighlightStyle },
			{ markdown },
			{ tags },
			{ yCollab, yUndoManagerKeymap },
			YRuntime
		] = await Promise.all([
			import('@codemirror/view'),
			import('@codemirror/state'),
			import('@codemirror/commands'),
			import('@codemirror/language'),
			import('@codemirror/lang-markdown'),
			import('@lezer/highlight'),
			import('y-codemirror.next'),
			import('yjs')
		]);

		// Obsidian-style source highlighting, themed via the shadcn semantic
		// tokens so light/dark tracks the app palette automatically (the tokens
		// are re-defined per `.dark`, so no `isDark` branching is needed here).
		const markdownHighlight = HighlightStyle.define([
			{ tag: tags.heading1, fontSize: '1.5em', fontWeight: '700' },
			{ tag: tags.heading2, fontSize: '1.3em', fontWeight: '700' },
			{ tag: tags.heading3, fontSize: '1.15em', fontWeight: '600' },
			{ tag: tags.heading, fontWeight: '600' },
			{ tag: tags.strong, fontWeight: '700' },
			{ tag: tags.emphasis, fontStyle: 'italic' },
			{ tag: tags.strikethrough, textDecoration: 'line-through' },
			{ tag: tags.link, color: 'var(--color-primary)', textDecoration: 'underline' },
			{ tag: tags.url, color: 'var(--color-primary)' },
			{ tag: tags.monospace, color: 'var(--color-muted-foreground)' },
			{ tag: tags.quote, color: 'var(--color-muted-foreground)', fontStyle: 'italic' },
			{ tag: tags.meta, color: 'var(--color-muted-foreground)' },
			{ tag: tags.processingInstruction, color: 'var(--color-muted-foreground)' },
			{ tag: tags.contentSeparator, color: 'var(--color-muted-foreground)', fontWeight: '700' }
		]);

		buildTheme = (isDark: boolean) =>
			EV.theme(
				{
					'&': { height: '100%', fontSize: '0.95rem', backgroundColor: 'transparent' },
					'.cm-scroller': {
						fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
						lineHeight: '1.65'
					},
					'.cm-content': {
						caretColor: 'var(--color-foreground)',
						padding: '1rem 0'
					},
					'.cm-line': { padding: '0 1.25rem' },
					'&.cm-focused': { outline: 'none' },
					'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
						backgroundColor: 'var(--color-accent)'
					},
					'.cm-cursor': { borderLeftColor: 'var(--color-foreground)' },
					// y-codemirror.next remote carets/name tags — the tag's fill
					// color comes from each peer's presence color
					// ($lib/collab/user-colors, decorative); only its typography is
					// themed here, via the app's own system font stack (no CM
					// monospace inheritance for this UI label).
					'.cm-ySelectionInfo': {
						fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
						fontSize: '0.65rem',
						padding: '0.05rem 0.3rem',
						borderRadius: '0.25rem',
						zIndex: '30'
					}
				},
				{ dark: isDark }
			);

		themeCompartment = new Compartment();
		const undoManager = new YRuntime.UndoManager(ytext);

		const extensions: Extension[] = [
			markdown(),
			syntaxHighlighting(markdownHighlight),
			EV.lineWrapping,
			themeCompartment.of(buildTheme(dark)),
			yCollab(ytext, awareness, { undoManager }),
			// Yjs owns undo (yUndoManagerKeymap) — @codemirror/commands history()
			// must NOT be added, it would fight the shared type.
			keymap.of([...yUndoManagerKeymap, ...defaultKeymap, indentWithTab])
		];
		if (readonly) {
			extensions.push(EditorState.readOnly.of(true), EV.editable.of(false));
		}

		view = new EV({
			parent: editorEl,
			state: EditorState.create({ doc: ytext.toString(), extensions })
		});
		ready = true;
	});

	// Follow app theme switches without rebuilding the editor.
	$effect(() => {
		if (view && themeCompartment && buildTheme) {
			view.dispatch({ effects: themeCompartment.reconfigure(buildTheme(dark)) });
		}
	});

	onDestroy(() => {
		view?.destroy();
		view = null;
	});
</script>

<div class="relative h-full min-h-0" data-testid="markdown-editor">
	{#if !ready}
		<div class="absolute inset-0 grid place-items-center">
			<Skeleton class="h-6 w-40" />
		</div>
	{/if}
	<div bind:this={editorEl} class="h-full min-h-0 [&_.cm-editor]:h-full"></div>
</div>
