<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import { ICONS } from '$lib/utils/icons';
	import { createLibraryPeople } from '$lib/state/library-people.svelte';
	import type { LibraryFile, PersonFace } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AlcovesImage from '$lib/components/ui/AlcovesImage.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';

	// This page reads route params (and the people store) rather than the layout's
	// `data`, mirroring the other library tab pages — so no `data` prop is declared.
	const libraryId = $derived(page.params.id ?? '');
	const personId = $derived(page.params.personId ?? '');

	// The store mirrors the old SPA: it owns people, the active person and that
	// person's faces, plus the cover-set / split-face mutations. We drive it from
	// the route params here.
	const people = createLibraryPeople(() => page.params.id ?? '');

	let loading = $state(false);

	// File preview is page-local (the store doesn't track it). Files are cached so
	// re-opening the same crop's source file doesn't refetch.
	let previewFile = $state<LibraryFile | null>(null);
	let previewOpen = $state(false);
	const fileCache = new Map<string, LibraryFile>();

	// Context menu for a single face crop (right-click), mirroring the Nuxt
	// `UContextMenu`. We position a small popover at the cursor.
	let menuFace = $state<PersonFace | null>(null);
	let menuX = $state(0);
	let menuY = $state(0);

	const person = $derived(people.activePerson);
	const faces = $derived(people.activePersonFaces);
	const personLabel = $derived(person?.name?.trim() || 'Unnamed person');
	const previewFiles = $derived<LibraryFile[]>(previewFile ? [previewFile] : []);
	// While a cover-set or split is in flight the affected crop shows a spinner.
	const actionFaceId = $derived(people.updatingCoverFaceId ?? people.splittingFaceId);

	function goBack() {
		goto(`/libraries/${libraryId}/people`);
	}

	async function fetchPersonAndFaces() {
		loading = true;
		try {
			await people.fetchPeople();
			const found = people.people.find((candidate) => candidate.id === personId) ?? null;
			if (!found) {
				people.closePersonDetail();
				return;
			}
			await people.loadPersonFaces(found);
		} catch {
			toast.add({ title: 'Failed to load person', color: 'error' });
		} finally {
			loading = false;
		}
	}

	async function openFacePreview(face: PersonFace) {
		const cached = fileCache.get(face.fileId);
		if (cached) {
			previewFile = cached;
			previewOpen = true;
			return;
		}

		try {
			const file = await api.files.get(libraryId, face.fileId);
			fileCache.set(file.id, file);
			previewFile = file;
			previewOpen = true;
		} catch {
			toast.add({ title: 'Failed to load file preview', color: 'error' });
		}
	}

	function openFaceMenu(face: PersonFace, event: MouseEvent) {
		event.preventDefault();
		menuFace = face;
		menuX = event.clientX;
		menuY = event.clientY;
	}

	function closeFaceMenu() {
		menuFace = null;
	}

	async function updateCoverPhoto(face: PersonFace) {
		closeFaceMenu();
		await people.setPersonCover(personId, face.id);
	}

	async function createNewPerson(face: PersonFace) {
		closeFaceMenu();
		await people.splitFaceAsNewPerson(personId, face.id);
		// The store refreshes the active person/faces. If the person is gone or has
		// no faces left, fall back to the people list.
		if (!people.activePerson || people.activePersonFaces.length === 0) {
			goBack();
		}
	}

	// Dismiss the context menu on any outside click / Escape.
	function onWindowClick() {
		if (menuFace) closeFaceMenu();
	}
	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && menuFace) closeFaceMenu();
	}

	onMount(() => {
		fetchPersonAndFaces();
		window.addEventListener('click', onWindowClick);
		window.addEventListener('keydown', onWindowKeydown);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', onWindowClick);
			window.removeEventListener('keydown', onWindowKeydown);
		}
	});
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
	<div class="flex items-center gap-3">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-surface-700-300 hover:bg-surface-100-900"
			onclick={goBack}
		>
			<AppIcon name={ICONS.back} class="size-4" />
			Back
		</button>
		<div class="min-w-0">
			<p class="truncate text-sm font-semibold">{personLabel}</p>
			<p class="text-xs text-surface-600-400">
				{faces.length}
				{faces.length === 1 ? 'face' : 'faces'}
			</p>
		</div>
	</div>

	{#if loading || people.loadingFaces}
		<div class="flex items-center justify-center py-16">
			<AppIcon name={ICONS.loading} class="size-5 animate-spin text-surface-600-400" />
		</div>
	{:else if !person}
		<div class="flex flex-col items-center justify-center gap-3 px-4 py-16">
			<p class="text-sm text-surface-600-400">Person not found in this library</p>
			<button
				type="button"
				class="rounded-md bg-primary-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600"
				onclick={goBack}
			>
				Back to People
			</button>
		</div>
	{:else if faces.length}
		<div class="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
			{#each faces as face (face.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="relative cursor-pointer overflow-hidden rounded-md bg-surface-100-900 transition hover:bg-surface-200-800"
					onclick={() => openFacePreview(face)}
					oncontextmenu={(e) => openFaceMenu(face, e)}
				>
					<AlcovesImage
						{libraryId}
						fileId={face.fileId}
						alt={face.fileName}
						variant="face"
						class="aspect-square w-full object-cover"
					/>
					{#if actionFaceId === face.id}
						<div class="absolute inset-0 flex items-center justify-center bg-black/40">
							<AppIcon name={ICONS.loading} class="size-5 animate-spin text-white" />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<div class="flex items-center justify-center py-16">
			<p class="text-sm text-surface-600-400">No faces available for this person</p>
		</div>
	{/if}
</div>

{#if menuFace}
	{@const face = menuFace}
	<!-- The window listener closes the menu on any click; stop propagation here so a
	     click inside the menu (on the items) doesn't immediately dismiss it. -->
	<div
		class="fixed z-50 w-56 card rounded-md border border-surface-200-800 preset-filled-surface-50-950 p-1 shadow-lg"
		style="left: {menuX}px; top: {menuY}px;"
		role="menu"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		oncontextmenu={(e) => e.preventDefault()}
	>
		<button
			type="button"
			role="menuitem"
			class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-100-900"
			onclick={() => updateCoverPhoto(face)}
		>
			<AppIcon name={ICONS.image} class="size-4" />
			Update cover photo
		</button>
		<button
			type="button"
			role="menuitem"
			class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-100-900"
			onclick={() => createNewPerson(face)}
		>
			<AppIcon name={ICONS.person} class="size-4" />
			New person
		</button>
	</div>
{/if}

{#if previewFile}
	<FilePreview
		bind:open={previewOpen}
		file={previewFile}
		{libraryId}
		files={previewFiles}
		onnavigate={(f) => (previewFile = f)}
	/>
{/if}
