<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		open: boolean;
		color: string;
		draft: string;
		palette: readonly string[];
		keyId: string;
		title?: string;
		ontoggle?: () => void;
		onpick?: (color: string) => void;
		onupdateDraft?: (value: string) => void;
		oncommitDraft?: () => void;
	}

	let {
		open,
		color,
		draft,
		palette,
		keyId,
		title = 'Select tag color',
		ontoggle,
		onpick,
		onupdateDraft,
		oncommitDraft
	}: Props = $props();

	const selected = $derived(color.toUpperCase());
</script>

<div class="relative inline-block" data-color-dropdown>
	<button
		type="button"
		class="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-surface-200-800"
		{title}
		onclick={(e) => {
			e.preventDefault();
			ontoggle?.();
		}}
	>
		<span class="size-4 rounded-full" style:background-color={color}></span>
	</button>
	{#if open}
		<div
			class="absolute top-full left-0 z-20 mt-2 w-52 card rounded-xl border border-surface-200-800 preset-filled-surface-50-950 p-4 shadow-lg"
		>
			<div class="grid grid-cols-4 gap-2">
				{#each palette as entry (`${keyId}-${entry}`)}
					<button
						type="button"
						class="relative size-9 rounded-full border border-surface-300-700 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
						class:ring-2={entry === selected}
						class:ring-primary-500={entry === selected}
						style:background-color={entry}
						title={entry}
						onclick={() => onpick?.(entry)}
					>
						{#if entry === selected}
							<AppIcon
								name={ICONS.check}
								class="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow"
							/>
						{/if}
					</button>
				{/each}
			</div>
			<input
				class="mt-2 input w-full font-mono uppercase"
				type="text"
				value={draft}
				placeholder="#3B82F6"
				oninput={(e) => onupdateDraft?.(e.currentTarget.value)}
				onblur={() => oncommitDraft?.()}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						oncommitDraft?.();
					}
				}}
			/>
		</div>
	{/if}
</div>
