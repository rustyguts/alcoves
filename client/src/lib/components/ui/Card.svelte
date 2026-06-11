<script lang="ts">
	/**
	 * Card — the low-level surface primitive.
	 *
	 * Standardises the three surface treatments used ad-hoc across the app:
	 * - `tonal`    — the muted bordered panel surface (matches AppPanel).
	 * - `filled`   — a solid surface (matches modals).
	 * - `elevated` — a solid surface with a shadow (matches menus/popovers).
	 *
	 * `AppPanel` is the titled section built on top of this; reach for `Card`
	 * directly when you just need the surface with a padding scale.
	 */
	import type { Snippet } from 'svelte';

	type Tone = 'tonal' | 'filled' | 'elevated';
	type Padding = 'none' | 'sm' | 'md' | 'lg';

	interface Props {
		tone?: Tone;
		padding?: Padding;
		class?: string;
		/** Optional bordered header region. */
		header?: Snippet;
		/** Optional bordered footer region. */
		footer?: Snippet;
		children?: Snippet;
		[key: string]: unknown;
	}

	let {
		tone = 'tonal',
		padding = 'md',
		class: klass = '',
		header,
		footer,
		children,
		...rest
	}: Props = $props();

	const TONE: Record<Tone, string> = {
		tonal: 'preset-tonal-surface border border-surface-200-800',
		filled: 'preset-filled-surface-50-950',
		elevated: 'preset-filled-surface-100-900 border border-surface-200-800 shadow-xl'
	};

	const PAD: Record<Padding, string> = {
		none: 'p-0',
		sm: 'p-3',
		md: 'p-4',
		lg: 'p-6'
	};

	const surfaceClass = $derived(['card', TONE[tone], klass].filter(Boolean).join(' '));
	// Header/footer regions keep their own padding even when the body is flush.
	const regionPad = $derived(PAD[padding === 'none' ? 'md' : padding]);
</script>

<div class={surfaceClass} {...rest}>
	{#if header}
		<div class="border-b border-surface-200-800 {regionPad}">
			{@render header()}
		</div>
	{/if}

	<div class={PAD[padding]}>
		{@render children?.()}
	</div>

	{#if footer}
		<div class="border-t border-surface-200-800 {PAD[padding === 'none' ? 'md' : padding]}">
			{@render footer()}
		</div>
	{/if}
</div>
