<script lang="ts">
	import { apiUrl } from '$lib/api';
	import { Tooltip } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		displayName: string;
		avatarUrl?: string | null;
		/** Tailwind sizing applied directly to the avatar (e.g. `w-8`, `size-10`). */
		sizeClass?: string;
		textSizeClass?: string;
		bgClass?: string;
		roundedClass?: string;
		tooltip?: boolean;
		tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
	}

	let {
		displayName,
		avatarUrl = null,
		sizeClass = 'w-8',
		textSizeClass = 'text-xs',
		bgClass = '',
		roundedClass = '',
		tooltip = false,
		tooltipPosition = 'right'
	}: Props = $props();

	const alt = $derived(displayName);
	const initial = $derived(displayName.charAt(0).toUpperCase());
	const resolvedSrc = $derived(avatarUrl ? apiUrl(avatarUrl) : undefined);
	const rounded = $derived(roundedClass || 'rounded-full');
	const bg = $derived(bgClass || 'preset-tonal-surface');
</script>

{#snippet avatar()}
	{#if resolvedSrc}
		<img
			src={resolvedSrc}
			{alt}
			class="aspect-square shrink-0 object-cover {sizeClass} {rounded}"
		/>
	{:else}
		<span
			class="inline-flex aspect-square shrink-0 items-center justify-center font-medium {sizeClass} {textSizeClass} {rounded} {bg}"
			aria-label={alt}
			title={alt}
		>
			{initial}
		</span>
	{/if}
{/snippet}

{#if tooltip}
	<Tooltip positioning={{ placement: tooltipPosition }} openDelay={200} closeDelay={0}>
		<Tooltip.Trigger
			class="inline-flex cursor-default border-0 bg-transparent p-0"
			aria-label={displayName}
		>
			{@render avatar()}
		</Tooltip.Trigger>
		<Tooltip.Positioner>
			<Tooltip.Content class="z-50 card preset-filled-surface-900-100 px-2 py-1 text-xs">
				{displayName}
			</Tooltip.Content>
		</Tooltip.Positioner>
	</Tooltip>
{:else}
	{@render avatar()}
{/if}
