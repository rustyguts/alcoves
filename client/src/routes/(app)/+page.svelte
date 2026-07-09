<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { toast } from '$lib/state/toast';
	import type { PageProps } from './$types';

	/**
	 * Home. The Nuxt original redirected to the default library and rendered an
	 * empty `<div/>` otherwise; the redirect now lives in +page.ts. We only reach
	 * this component when the user has NO libraries, so it's the first-run /
	 * create-first-library state — give them a one-click way to make one rather
	 * than a blank screen.
	 */
	let { data }: PageProps = $props();

	let name = $state('');
	let creating = $state(false);

	async function createFirstLibrary(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || creating) return;
		creating = true;
		try {
			const library = await api.libraries.create({ name: trimmed });
			// Refresh the shell so the new library shows in the sidebar, then jump in.
			await invalidateAll();
			await goto(`/libraries/${library.id}`);
		} catch {
			toast.error('Could not create library', 'Please try again.');
			creating = false;
		}
	}
</script>

{#if data.libraries.length === 0}
	<div class="flex min-h-0 flex-1 items-center justify-center">
		<EmptyState
			icon={ICONS.library}
			title="Welcome to Alcoves"
			description="You don't have any libraries yet. Create your first one to start adding files."
		>
			{#snippet actions()}
				<form class="flex w-full max-w-xs flex-col gap-3" onsubmit={createFirstLibrary}>
					<Field.Field class="text-left">
						<Label for="first-library-name">Library name</Label>
						<Input
							id="first-library-name"
							type="text"
							placeholder="My Library"
							bind:value={name}
							disabled={creating}
						/>
					</Field.Field>
					<Button type="submit" disabled={creating || name.trim().length === 0}>
						{#if creating}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.plus} class="size-4" />
						{/if}
						<span>{creating ? 'Creating…' : 'Create library'}</span>
					</Button>
				</form>
			{/snippet}
		</EmptyState>
	</div>
{/if}
