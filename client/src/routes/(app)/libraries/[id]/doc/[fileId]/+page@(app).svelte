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
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { ICONS } from '$lib/utils/icons';
	import { cn } from '$lib/utils';
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
		<Alert.Root variant="destructive" data-testid="doc-error">
			<AppIcon name={ICONS.error} class="size-4 shrink-0" />
			<Alert.Title>Failed to open this document</Alert.Title>
			<Alert.Description>{provider.loadError}</Alert.Description>
		</Alert.Root>
	{:else if !provider.loaded}
		<div class="grid flex-1 place-items-center">
			<Skeleton class="h-6 w-48" />
		</div>
	{:else}
		<div
			class={cn(
				'min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card text-card-foreground',
				mode === 'split' && 'grid grid-cols-2 divide-x divide-border'
			)}
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
