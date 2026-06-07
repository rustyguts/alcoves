<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		/** The currently selected emoji, or `null` when none is chosen. */
		value?: string | null;
		/** Fired with the chosen emoji, or `null` when cleared. */
		onselect?: (value: string | null) => void;
	}

	let { value = null, onselect }: Props = $props();

	let open = $state(false);
	let pickerRef = $state<HTMLElement | null>(null);

	const emojiCategories = [
		{
			label: 'Smileys',
			emojis: [
				'\u{1F60A}',
				'\u{1F604}',
				'\u{1F60E}',
				'\u{1F525}',
				'\u{2764}\u{FE0F}',
				'\u{2B50}',
				'\u{1F31F}',
				'\u{26A1}',
				'\u{1F3AF}',
				'\u{1F680}',
				'\u{1F389}',
				'\u{1F381}',
				'\u{1F48E}',
				'\u{1F451}',
				'\u{1F3C6}',
				'\u{1F3B5}'
			]
		},
		{
			label: 'Nature',
			emojis: [
				'\u{1F33A}',
				'\u{1F333}',
				'\u{1F335}',
				'\u{1F340}',
				'\u{1F341}',
				'\u{1F330}',
				'\u{1F338}',
				'\u{1F337}',
				'\u{1F331}',
				'\u{1F30A}',
				'\u{2600}\u{FE0F}',
				'\u{1F308}',
				'\u{26C5}',
				'\u{2744}\u{FE0F}',
				'\u{1F30D}',
				'\u{1F319}'
			]
		},
		{
			label: 'Animals',
			emojis: [
				'\u{1F436}',
				'\u{1F431}',
				'\u{1F43B}',
				'\u{1F98A}',
				'\u{1F981}',
				'\u{1F985}',
				'\u{1F427}',
				'\u{1F422}',
				'\u{1F40B}',
				'\u{1F42C}',
				'\u{1F99C}',
				'\u{1F98B}',
				'\u{1F41D}',
				'\u{1F419}',
				'\u{1F40D}',
				'\u{1F98E}'
			]
		},
		{
			label: 'Food',
			emojis: [
				'\u{1F34E}',
				'\u{1F352}',
				'\u{1F353}',
				'\u{1F34A}',
				'\u{1F347}',
				'\u{1F349}',
				'\u{1F370}',
				'\u{1F354}',
				'\u{1F355}',
				'\u{1F32E}',
				'\u{2615}',
				'\u{1F37A}',
				'\u{1F377}',
				'\u{1F375}',
				'\u{1F366}',
				'\u{1F36D}'
			]
		},
		{
			label: 'Objects',
			emojis: [
				'\u{1F4D6}',
				'\u{1F4DA}',
				'\u{1F4F7}',
				'\u{1F3A8}',
				'\u{1F3B6}',
				'\u{1F3AC}',
				'\u{1F4BB}',
				'\u{1F52C}',
				'\u{1F4A1}',
				'\u{1F513}',
				'\u{1F4E6}',
				'\u{1F4CC}',
				'\u{270F}\u{FE0F}',
				'\u{1F4DD}',
				'\u{1F4C1}',
				'\u{1F5C2}\u{FE0F}'
			]
		},
		{
			label: 'Travel',
			emojis: [
				'\u{2708}\u{FE0F}',
				'\u{1F697}',
				'\u{1F6A2}',
				'\u{1F682}',
				'\u{1F3D4}\u{FE0F}',
				'\u{1F3D6}\u{FE0F}',
				'\u{1F3E0}',
				'\u{1F3F0}',
				'\u{26FA}',
				'\u{1F5FA}\u{FE0F}',
				'\u{1F3DD}\u{FE0F}',
				'\u{1F30B}',
				'\u{1F6A1}',
				'\u{1F3ED}',
				'\u{1F3EB}',
				'\u{26F5}'
			]
		}
	];

	function selectEmoji(emoji: string) {
		onselect?.(emoji);
		open = false;
	}

	function clearEmoji() {
		onselect?.(null);
		open = false;
	}

	function handleClickOutside(event: MouseEvent) {
		if (pickerRef && !pickerRef.contains(event.target as Node)) {
			open = false;
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClickOutside, true);
		} else {
			document.removeEventListener('click', handleClickOutside, true);
		}
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.removeEventListener('click', handleClickOutside, true);
		}
	});
</script>

<div bind:this={pickerRef} class="relative inline-block">
	<button
		type="button"
		class="inline-flex size-10 items-center justify-center rounded-lg transition-colors hover:bg-surface-200-800"
		title="Choose emoji icon"
		onclick={(e) => {
			e.stopPropagation();
			open = !open;
		}}
	>
		{#if value}
			<span class="text-2xl leading-none">{value}</span>
		{:else}
			<AppIcon name={ICONS.emoji} class="size-5 opacity-60" />
		{/if}
	</button>

	{#if open}
		<div
			class="absolute top-full left-0 z-50 mt-2 w-72 card rounded-lg border border-surface-200-800 preset-filled-surface-100-900 p-3 shadow-xl"
		>
			<div class="mb-2 flex items-center justify-between">
				<span class="text-xs font-semibold opacity-60">Pick an icon</span>
				{#if value}
					<button type="button" class="btn preset-tonal btn-sm" onclick={clearEmoji}>
						Remove
					</button>
				{/if}
			</div>
			{#each emojiCategories as category (category.label)}
				<div class="mb-2 last:mb-0">
					<p class="mb-1 text-xs opacity-40">{category.label}</p>
					<div class="grid grid-cols-8 gap-0.5">
						{#each category.emojis as emoji (emoji)}
							<button
								type="button"
								class="inline-flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-surface-200-800"
								class:preset-tonal-primary={value === emoji}
								onclick={() => selectEmoji(emoji)}
							>
								{emoji}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
