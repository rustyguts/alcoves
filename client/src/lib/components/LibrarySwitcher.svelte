<script lang="ts">
	import { goto } from '$app/navigation';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
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
		goto(`/libraries/${id}`);
	}

	function createLibrary() {
		oncreate?.();
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
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
	</DropdownMenu.Trigger>

	<DropdownMenu.Content class="w-64" align="start">
		{#if def}
			<DropdownMenu.Item onSelect={() => select(def.id)}>
				{#if def.emoji}
					<span class="shrink-0 text-base leading-none">{def.emoji}</span>
				{:else}
					<AppIcon name={ICONS.library} class="size-4 shrink-0 opacity-60" />
				{/if}
				<span class="min-w-0 flex-1 truncate">{def.name}</span>
				{#if def.id === current?.id}
					<AppIcon name={ICONS.check} class="size-4 shrink-0 text-primary" />
				{/if}
			</DropdownMenu.Item>
		{/if}

		{#if others.length}
			{#if def}
				<DropdownMenu.Separator />
			{/if}
			{#each others as l (l.id)}
				<DropdownMenu.Item onSelect={() => select(l.id)}>
					{#if l.emoji}
						<span class="shrink-0 text-base leading-none">{l.emoji}</span>
					{:else}
						<AppIcon name={ICONS.folder} class="size-4 shrink-0 opacity-60" />
					{/if}
					<span class="min-w-0 flex-1 truncate">{l.name}</span>
					{#if l.id === current?.id}
						<AppIcon name={ICONS.check} class="size-4 shrink-0 text-primary" />
					{/if}
				</DropdownMenu.Item>
			{/each}
		{/if}

		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={createLibrary}>
			<AppIcon name={ICONS.plus} class="size-4 shrink-0 opacity-60" />
			<span class="min-w-0 flex-1 truncate">New library</span>
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
