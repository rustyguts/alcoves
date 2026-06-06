<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
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
	<div class="flex min-h-0 flex-1 items-center justify-center px-4 py-16">
		<div class="w-full max-w-sm text-center">
			<div
				class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-surface-200-800"
			>
				<AppIcon name={ICONS.library} class="size-8 text-surface-500" />
			</div>
			<h1 class="mb-1 text-lg font-medium">Welcome to Alcoves</h1>
			<p class="mb-6 text-sm text-surface-500">
				You don't have any libraries yet. Create your first one to start adding files.
			</p>

			<form class="flex flex-col gap-3" onsubmit={createFirstLibrary}>
				<label class="label text-left">
					<span class="label-text">Library name</span>
					<input
						class="input"
						type="text"
						placeholder="My Library"
						aria-label="Library name"
						bind:value={name}
						disabled={creating}
					/>
				</label>
				<button
					type="submit"
					class="btn preset-filled-primary-500"
					disabled={creating || name.trim().length === 0}
				>
					<AppIcon name={ICONS.plus} class="size-4" />
					<span>{creating ? 'Creating…' : 'Create library'}</span>
				</button>
			</form>
		</div>
	</div>
{/if}
