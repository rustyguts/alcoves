<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ICONS } from '$lib/utils/icons';
	import { createLibraryPeople } from '$lib/state/library-people.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import AppModal from '$lib/components/ui/AppModal.svelte';

	/**
	 * People (face clusters) grid for a single library. Ported from the Nuxt
	 * `pages/libraries/[id]/people/index.vue`. The library itself comes from the
	 * subtree layout's `data.library`, so this page only manages the people store:
	 * fetch on mount, click to (de)select, double-click to open the person detail,
	 * right-click to rename, and merge two-or-more selected clusters.
	 */

	const libraryId = $derived(page.params.id ?? '');

	const people = createLibraryPeople(() => page.params.id ?? '');

	let renamePersonOpen = $state(false);
	let renamePersonTarget = $state<{ id: string; name: string | null } | null>(null);
	let renamePersonValue = $state('');
	let renamingPersonSavingId = $state<string | null>(null);

	function openRenamePersonModal(person: { id: string; name: string | null }) {
		renamePersonTarget = person;
		renamePersonValue = person.name ?? '';
		renamePersonOpen = true;
	}

	function closeRenamePersonModal() {
		if (renamingPersonSavingId) return;
		renamePersonOpen = false;
		renamePersonTarget = null;
		renamePersonValue = '';
	}

	async function confirmRenamePerson() {
		const target = renamePersonTarget;
		if (!target || renamingPersonSavingId) return;

		renamingPersonSavingId = target.id;
		await people.renamePerson(target.id, renamePersonValue.trim());
		renamingPersonSavingId = null;
		closeRenamePersonModal();
	}

	// The Nuxt original held a `reactive(new Set)` and called `.clear()` directly.
	// The ported store reassigns the selection Set immutably and only exposes a
	// per-id toggle, so clearing means toggling every currently-selected id off.
	function clearSelection() {
		for (const id of Array.from(people.selectedPeople)) {
			people.togglePersonSelection(id);
		}
	}

	function openPerson(personId: string) {
		goto(`/libraries/${libraryId}/people/${personId}`);
	}

	function getPersonAlt(person: { name: string | null }): string {
		return person.name?.trim() || 'Unnamed person';
	}

	function onThumbError(event: Event) {
		(event.target as HTMLImageElement).style.display = 'none';
	}

	function onRenameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			confirmRenamePerson();
		}
	}

	onMount(() => {
		people.fetchPeople();
	});
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-0.5">
	<div class="grid gap-4">
		{#if people.selectedPeople.size >= 2}
			<div class="flex items-center gap-2">
				<Button size="sm" onclick={() => people.mergePeople()}>
					{#snippet icon()}
						<AppIcon name={ICONS.mergePeople} class="size-4" />
					{/snippet}
					<span>Merge Selected</span>
				</Button>
				<span class="text-sm opacity-75">{people.selectedPeople.size} selected</span>
				<Button variant="tonal" color="surface" size="sm" onclick={clearSelection}>Clear</Button>
			</div>
		{/if}

		{#if people.loading}
			<div class="flex items-center justify-center py-16">
				<AppIcon name={ICONS.loading} class="size-5 animate-spin opacity-75" />
			</div>
		{:else if people.people.length}
			<div class="space-y-2 p-2">
				<div class="flex flex-wrap gap-2">
					{#each people.people as person (person.id)}
						<button
							type="button"
							class="group relative size-40 shrink-0 cursor-pointer overflow-hidden rounded-md bg-surface-100-900 transition select-none {people.selectedPeople.has(
								person.id
							)
								? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-surface-50-950'
								: 'hover:bg-surface-200-800'}"
							title={person.name?.trim() || 'Unnamed person'}
							onclick={() => people.togglePersonSelection(person.id)}
							ondblclick={() => openPerson(person.id)}
							oncontextmenu={(e) => {
								e.preventDefault();
								openRenamePersonModal(person);
							}}
						>
							<img
								src={people.getPersonThumbnailUrl(person)}
								alt={getPersonAlt(person)}
								class="size-full object-cover"
								loading="lazy"
								onerror={onThumbError}
							/>
							<div
								class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
							></div>
							<div
								class="pointer-events-none absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white"
							>
								{person.faceCount}
							</div>
							{#if person.name?.trim()}
								<div class="pointer-events-none absolute inset-x-2 bottom-2">
									<p class="truncate text-center text-xs font-medium text-white">
										{person.name}
									</p>
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<EmptyState
				icon={ICONS.people}
				title="No faces detected yet"
				description="Upload images to this library and faces will be automatically detected and grouped."
			/>
		{/if}
	</div>

	<!-- Rename person modal -->
	<AppModal
		bind:open={renamePersonOpen}
		title="Name Person"
		description="Leave blank to remove the name"
	>
		<div class="flex flex-col gap-2">
			<label class="text-sm font-medium" for="rename-person-input">Person name</label>
			<input
				id="rename-person-input"
				class="input"
				bind:value={renamePersonValue}
				placeholder="e.g. Alex"
				onkeydown={onRenameKeydown}
			/>
			<p class="text-xs opacity-75">Leave blank to remove the name</p>
		</div>

		<div class="flex w-full justify-end gap-2">
			<Button
				variant="tonal"
				color="surface"
				size="sm"
				disabled={!!renamingPersonSavingId}
				onclick={closeRenamePersonModal}
			>
				Cancel
			</Button>
			<Button
				size="sm"
				loading={!!renamingPersonSavingId}
				disabled={!!renamingPersonSavingId || !renamePersonTarget}
				onclick={confirmRenamePerson}
			>
				<span>Save</span>
			</Button>
		</div>
	</AppModal>
</div>
