<script lang="ts">
	/**
	 * UserAvatar — the one avatar treatment used across the app.
	 *
	 * Sizing is a constrained `size` enum (`xs`/`sm`/`md`/`lg`) mapped to
	 * `size-*` classes, never free-form `w-*`/`h-*`. This is load-bearing:
	 * the vendored `Avatar.Root` ships a base `size-8`, and tailwind-merge
	 * drops an EARLIER `size-*` class whenever a LATER override lands in the
	 * same conflict group. A `w-*` override only conflicts with `w-*` (not
	 * `size-*`'s height half), so `cn('size-8 ...', 'w-6')` used to strip the
	 * base `size-8` down to `w-6` with no `h-*` left to replace it — the
	 * avatar's height then fell back to intrinsic/auto sizing and stretched
	 * (most visible in a table cell, e.g. LibraryEntriesTable's owner
	 * column). Always emitting `size-*` keeps every override in the same
	 * conflict group, so it cleanly replaces both dimensions together.
	 */
	import { apiUrl } from '$lib/api';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { cn } from '$lib/utils';

	type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

	interface Props {
		displayName: string;
		avatarUrl?: string | null;
		/** Constrained avatar size. Always circular, always `shrink-0`. */
		size?: AvatarSize;
		/** Fallback-initial tint, e.g. `bg-primary/10 text-primary`. */
		bgClass?: string;
		tooltip?: boolean;
		tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
	}

	let {
		displayName,
		avatarUrl = null,
		size = 'md',
		bgClass = '',
		tooltip = false,
		tooltipPosition = 'right'
	}: Props = $props();

	const SIZE_CLASSES: Record<AvatarSize, string> = {
		xs: 'size-6',
		sm: 'size-7',
		md: 'size-8',
		lg: 'size-10'
	};

	const TEXT_SIZE_CLASSES: Record<AvatarSize, string> = {
		xs: 'text-[10px]',
		sm: 'text-xs',
		md: 'text-xs',
		lg: 'text-sm'
	};

	const alt = $derived(displayName);
	const initial = $derived(displayName.charAt(0).toUpperCase());
	const resolvedSrc = $derived(avatarUrl ? apiUrl(avatarUrl) : undefined);
	const rootClass = $derived(cn(SIZE_CLASSES[size], 'shrink-0'));
	const textSizeClass = $derived(TEXT_SIZE_CLASSES[size]);
</script>

{#snippet avatar()}
	<Avatar.Root class={rootClass}>
		{#if resolvedSrc}
			<Avatar.Image src={resolvedSrc} {alt} />
		{/if}
		<Avatar.Fallback class={cn(textSizeClass, bgClass || 'bg-muted text-muted-foreground')}>
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
