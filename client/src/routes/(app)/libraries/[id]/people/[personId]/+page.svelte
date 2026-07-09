<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import { ICONS } from '$lib/utils/icons';
	import { createLibraryPeople } from '$lib/state/library-people.svelte';
	import type { LibraryFile, PersonFace } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import AlcovesImage from '$lib/components/ui/AlcovesImage.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FilePreview from '$lib/components/FilePreview.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';

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

	// Context menu for a single face crop (right-click). A single Root+Trigger
	// wraps the whole face grid (rather than one per tile) — the native
	// contextmenu event bubbles from whichever tile was clicked up to the
	// Trigger, which opens itself positioned at the cursor automatically;
	// `openFaceMenu` below only records which face the menu applies to. Mirrors
	// the entries-grid context menu in LibraryBrowser.svelte.
	//
	// Two guards keep `menuFace` from going stale (and the menu from opening on
	// grid gaps at all): a trigger-level `oncontextmenu` only forwards the event
	// to bits-ui's own handler when it lands on a tile (native browser menu
	// shows for gaps/trailing empty cells instead), and an effect clears
	// `menuFace` whenever the menu closes so no leftover face can be targeted by
	// a later stray open.
	let menuFace = $state<PersonFace | null>(null);
	let contextMenuOpen = $state(false);

	$effect(() => {
		if (!contextMenuOpen) {
			menuFace = null;
		}
	});

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

	function openFaceMenu(face: PersonFace) {
		menuFace = face;
	}

	async function updateCoverPhoto(face: PersonFace) {
		await people.setPersonCover(personId, face.id);
	}

	async function createNewPerson(face: PersonFace) {
		await people.splitFaceAsNewPerson(personId, face.id);
		// The store refreshes the active person/faces. If the person is gone or has
		// no faces left, fall back to the people list.
		if (!people.activePerson || people.activePersonFaces.length === 0) {
			goBack();
		}
	}

	onMount(() => {
		fetchPersonAndFaces();
	});
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
	<div class="flex items-center gap-3">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
			onclick={goBack}
		>
			<AppIcon name={ICONS.back} class="size-4" />
			Back
		</button>
		<div class="min-w-0">
			<p class="truncate text-sm font-semibold">{personLabel}</p>
			<p class="text-xs text-muted-foreground">
				{faces.length}
				{faces.length === 1 ? 'face' : 'faces'}
			</p>
		</div>
	</div>

	{#if loading || people.loadingFaces}
		<div class="flex items-center justify-center py-16">
			<AppIcon name={ICONS.loading} class="size-5 animate-spin text-muted-foreground" />
		</div>
	{:else if !person}
		<EmptyState
			icon={ICONS.person}
			title="Person not found"
			description="This person no longer exists in this library."
		>
			{#snippet actions()}
				<Button variant="outline" onclick={goBack}>
					<AppIcon name={ICONS.back} class="size-4" />
					Back to People
				</Button>
			{/snippet}
		</EmptyState>
	{:else if faces.length}
		<ContextMenu.Root bind:open={contextMenuOpen}>
			<ContextMenu.Trigger>
				{#snippet child({ props })}
					<div
						{...props}
						class="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
						oncontextmenu={(event: MouseEvent) => {
							// Only let bits-ui open the menu when the event landed on a
							// tile; otherwise leave it un-prevented so the native browser
							// context menu shows over grid gaps / the trailing empty row.
							if ((event.target as HTMLElement | null)?.closest('button')) {
								(props.oncontextmenu as ((e: MouseEvent) => void) | undefined)?.(event);
							}
						}}
					>
						{#each faces as face (face.id)}
							<button
								type="button"
								class="relative cursor-pointer overflow-hidden rounded-md bg-muted transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary"
								aria-label="Preview {face.fileName}"
								onclick={() => openFacePreview(face)}
								oncontextmenu={() => openFaceMenu(face)}
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
							</button>
						{/each}
					</div>
				{/snippet}
			</ContextMenu.Trigger>

			<!-- Right-click face-crop menu. A single Root+Trigger wraps the whole
			     face grid (rather than one per tile) — see the comment on
			     `contextMenuOpen` above. -->
			<ContextMenu.Content class="w-56">
				<ContextMenu.Item onSelect={() => menuFace && updateCoverPhoto(menuFace)}>
					<AppIcon name={ICONS.image} class="size-4" />
					Update cover photo
				</ContextMenu.Item>
				<ContextMenu.Item onSelect={() => menuFace && createNewPerson(menuFace)}>
					<AppIcon name={ICONS.person} class="size-4" />
					New person
				</ContextMenu.Item>
			</ContextMenu.Content>
		</ContextMenu.Root>
	{:else}
		<EmptyState
			icon={ICONS.people}
			title="No faces available"
			description="There are no face crops to show for this person yet."
		/>
	{/if}
</div>

{#if previewFile}
	<FilePreview
		bind:open={previewOpen}
		file={previewFile}
		{libraryId}
		files={previewFiles}
		onnavigate={(f) => (previewFile = f)}
	/>
{/if}
