<script lang="ts">
	import { goto } from '$app/navigation';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { Library } from '$lib/types/api';

	/**
	 * Account-switcher style control at the top of the sidebar. The trigger shows
	 * the library you're currently in; opening it reveals every other library so
	 * you can switch with one click. The default library is always pinned to the
	 * top of the list, and the current library is marked with a check.
	 */
	interface Props {
		libraries: Library[] | null;
		currentLibraryId: string | null;
		oncreate?: () => void;
	}

	let { libraries, currentLibraryId, oncreate }: Props = $props();

	let open = $state(false);

	const current = $derived.by(() => {
		const libs = libraries ?? [];
		return (
			libs.find((l) => l.id === currentLibraryId) ??
			libs.find((l) => l.isDefault) ??
			libs[0] ??
			null
		);
	});

	const def = $derived((libraries ?? []).find((l) => l.isDefault) ?? null);
	const others = $derived(
		(libraries ?? []).filter((l) => !l.isDefault).sort((a, b) => a.name.localeCompare(b.name))
	);

	function select(id: string) {
		open = false;
		goto(`/libraries/${id}`);
	}

	function createLibrary() {
		open = false;
		oncreate?.();
	}
</script>

<Popover {open} onOpenChange={(e) => (open = e.open)} positioning={{ placement: 'bottom-start' }}>
	<Popover.Trigger
		class="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:preset-tonal"
		aria-label={`Switch library, current: ${current?.name ?? 'none'}`}
	>
		{#if current?.emoji}
			<span class="shrink-0 text-lg leading-none">{current.emoji}</span>
		{:else}
			<AppIcon name={ICONS.library} class="size-5 shrink-0 opacity-60" />
		{/if}
		<span class="min-w-0 flex-1 truncate text-sm font-semibold">
			{current?.name ?? 'Select library'}
		</span>
		<AppIcon name={ICONS.dropdownCaret} class="size-4 shrink-0 opacity-40" />
	</Popover.Trigger>

	<Popover.Positioner class="z-50">
		<Popover.Content
			class="min-w-60 space-y-1 card rounded-lg border border-surface-200-800 preset-filled-surface-100-900 p-1 shadow-xl"
		>
			{#if def}
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:preset-tonal"
					onclick={() => select(def.id)}
				>
					{#if def.emoji}
						<span class="shrink-0 text-base leading-none">{def.emoji}</span>
					{:else}
						<AppIcon name={ICONS.library} class="size-4 shrink-0 opacity-60" />
					{/if}
					<span class="min-w-0 flex-1 truncate">{def.name}</span>
					{#if def.id === current?.id}
						<AppIcon name={ICONS.check} class="size-4 shrink-0 text-primary-500" />
					{/if}
				</button>
			{/if}

			{#if others.length}
				{#if def}
					<hr class="my-1 border-surface-200-800" />
				{/if}
				{#each others as l (l.id)}
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:preset-tonal"
						onclick={() => select(l.id)}
					>
						{#if l.emoji}
							<span class="shrink-0 text-base leading-none">{l.emoji}</span>
						{:else}
							<AppIcon name={ICONS.folder} class="size-4 shrink-0 opacity-60" />
						{/if}
						<span class="min-w-0 flex-1 truncate">{l.name}</span>
						{#if l.id === current?.id}
							<AppIcon name={ICONS.check} class="size-4 shrink-0 text-primary-500" />
						{/if}
					</button>
				{/each}
			{/if}

			<hr class="my-1 border-surface-200-800" />
			<button
				type="button"
				class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:preset-tonal"
				onclick={createLibrary}
			>
				<AppIcon name={ICONS.plus} class="size-4 shrink-0 opacity-60" />
				<span class="min-w-0 flex-1 truncate">New library</span>
			</button>
		</Popover.Content>
	</Popover.Positioner>
</Popover>
