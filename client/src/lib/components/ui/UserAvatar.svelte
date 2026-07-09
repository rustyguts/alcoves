<script lang="ts">
	import { apiUrl } from '$lib/api';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils';

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
</script>

{#snippet avatar()}
	<Avatar.Root class={cn(sizeClass, rounded)}>
		{#if resolvedSrc}
			<Avatar.Image src={resolvedSrc} {alt} class={rounded} />
		{/if}
		<Avatar.Fallback
			class={cn(textSizeClass, rounded, bgClass || 'bg-muted text-muted-foreground')}
		>
			{initial}
		</Avatar.Fallback>
	</Avatar.Root>
{/snippet}

{#if tooltip}
	<Tooltip.Provider>
		<Tooltip.Root>
			<Tooltip.Trigger
				class="inline-flex cursor-default border-0 bg-transparent p-0"
				aria-label={displayName}
			>
				{@render avatar()}
			</Tooltip.Trigger>
			<Tooltip.Content side={tooltipPosition}>
				{displayName}
			</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
{:else}
	{@render avatar()}
{/if}
