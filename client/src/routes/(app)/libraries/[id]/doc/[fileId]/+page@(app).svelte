<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { auth } from '$lib/state/auth.svelte';
	import { theme } from '$lib/state/theme.svelte';
	import { createDocProvider } from '$lib/collab/doc-provider.svelte';
	import DocEditorHeader, { type DocViewMode } from '$lib/components/doc/DocEditorHeader.svelte';
	import MarkdownEditor from '$lib/components/doc/MarkdownEditor.svelte';
	import MarkdownPreview from '$lib/components/doc/MarkdownPreview.svelte';
	import type { LibraryFile } from '$lib/types/api';

	const libraryId = $derived(page.params.id ?? '');
	const fileId = $derived(page.params.fileId ?? '');

	// Like the video editor, this page renders in the dashboard shell (the
	// `@(app)` breakout skips the library header) and fetches its own records.
	let file = $state<LibraryFile | null>(null);
	let mode = $state<DocViewMode>('edit');

	const provider = createDocProvider({
		getLibraryId: () => libraryId,
		getFileId: () => fileId,
		getUser: () => (auth.user ? { id: auth.user.id, name: auth.user.displayName } : null)
	});

	const canEdit = $derived(provider.role === 'editor');
	const dark = $derived(theme.resolved === 'dark');

	onMount(async () => {
		void api.files
			.get(libraryId, fileId)
			.then((f) => (file = f))
			.catch(() => {});
		try {
			await provider.load();
			// Viewers land on the rendered document; editors in the editor.
			mode = provider.role === 'viewer' ? 'preview' : 'edit';
		} catch {
			// provider.loadError renders the failure state below.
		}
	});

	// Warn before closing the tab while edits are still being saved. Regular
	// in-app navigation is safe: dispose() flushes with keepalive.
	function handleBeforeUnload(e: BeforeUnloadEvent) {
		if (provider.pendingCount > 0) e.preventDefault();
	}
	onMount(() => {
		if (!browser) return;
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	});

	onDestroy(() => provider.dispose());

	function goBack() {
		// Restore the folder the user opened the doc from (`?from=<folderId>`).
		const from = page.url.searchParams.get('from');
		const folderId = from && from.length > 0 ? from : null;
		const path = `/libraries/${libraryId}`;
		goto(folderId ? `${path}?folder=${encodeURIComponent(folderId)}` : path);
	}
</script>

<svelte:head>
	<title>{file?.name ?? 'Document'} · Alcoves</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
	<DocEditorHeader
		{file}
		peers={provider.peers}
		statusLabel={provider.statusLabel}
		{canEdit}
		{mode}
		onback={goBack}
		onmode={(m) => (mode = m)}
	/>

	{#if provider.loadError}
		<div class="rounded-lg preset-tonal-error p-4 text-sm" data-testid="doc-error">
			Failed to open this document: {provider.loadError}
		</div>
	{:else if !provider.loaded}
		<div class="grid flex-1 place-items-center">
			<div class="h-6 placeholder w-48 animate-pulse rounded"></div>
		</div>
	{:else}
		<div
			class="min-h-0 flex-1 overflow-hidden card preset-outlined-surface-200-800 {mode === 'split'
				? 'grid grid-cols-2 divide-x divide-surface-300-700'
				: ''}"
		>
			{#if mode === 'edit' || mode === 'split'}
				<!-- Keyed on generation: a resync replaces the Y.Doc, and
				     CodeMirror must rebind to the fresh Y.Text. -->
				{#key provider.generation}
					<MarkdownEditor
						ytext={provider.ytext}
						awareness={provider.awareness}
						readonly={!canEdit}
						{dark}
					/>
				{/key}
			{/if}
			{#if mode === 'preview' || mode === 'split'}
				<MarkdownPreview
					getText={() => provider.ytext.toString()}
					version={provider.contentVersion}
				/>
			{/if}
		</div>
	{/if}
</div>
