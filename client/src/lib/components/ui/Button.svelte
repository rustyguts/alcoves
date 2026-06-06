<script lang="ts">
	/**
	 * Button — the single button/link primitive for the app.
	 *
	 * It renders a real `<button>` (or `<a>` when `href` is set) and composes the
	 * exact Skeleton `btn`/`preset-*` class tokens the app already used by hand, so
	 * migrating an ad-hoc `<button class="btn preset-tonal-primary btn-sm">` to
	 * `<Button variant="tonal" color="primary" size="sm">` is byte-equivalent for
	 * CSS, `getByRole('button')`, and the `.toContain('preset-…')` class assertions
	 * in the component tests.
	 *
	 * - variant → Skeleton preset family (filled/tonal/outlined, or `ghost` = no
	 *   preset, hover only).
	 * - iconOnly → the `btn-icon` family instead of `btn`.
	 * - loading → swaps the leading `icon` snippet for a spinner and disables.
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	type Variant = 'filled' | 'tonal' | 'outlined' | 'ghost';
	type Color = 'primary' | 'surface' | 'error' | 'warning' | 'success';
	type Size = 'sm' | 'md' | 'lg';

	interface Props {
		variant?: Variant;
		color?: Color;
		size?: Size;
		/** Square icon button — uses the `btn-icon` family. */
		iconOnly?: boolean;
		/** Shows a spinner in place of `icon` and disables interaction. */
		loading?: boolean;
		disabled?: boolean;
		/** Stretch to the container width. */
		fullWidth?: boolean;
		/** Render an `<a>` instead of a `<button>`. */
		href?: string;
		/** Only used for the `<button>` element. */
		type?: 'button' | 'submit' | 'reset';
		class?: string;
		/** Leading icon, replaced by a spinner while `loading`. */
		icon?: Snippet;
		children?: Snippet;
		[key: string]: unknown;
	}

	let {
		variant = 'filled',
		color = 'primary',
		size = 'md',
		iconOnly = false,
		loading = false,
		disabled = false,
		fullWidth = false,
		href,
		type = 'button',
		class: klass = '',
		icon,
		children,
		...rest
	}: Props = $props();

	const preset = $derived.by(() => {
		switch (variant) {
			case 'filled':
				return `preset-filled-${color}-500`;
			case 'tonal':
				return `preset-tonal-${color}`;
			case 'outlined':
				return `preset-outlined-${color}-500`;
			case 'ghost':
				return 'hover:preset-tonal';
		}
	});

	const sizeToken = $derived.by(() => {
		const base = iconOnly ? 'btn-icon' : 'btn';
		if (size === 'sm') return `${base}-sm`;
		if (size === 'lg') return `${base}-lg`;
		return '';
	});

	const classes = $derived(
		[iconOnly ? 'btn-icon' : 'btn', preset, sizeToken, fullWidth ? 'w-full' : '', klass]
			.filter(Boolean)
			.join(' ')
	);

	const isDisabled = $derived(disabled || loading);
</script>

{#snippet inner()}
	{#if loading}
		<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
	{:else if icon}
		{@render icon()}
	{/if}
	{@render children?.()}
{/snippet}

{#if href}
	<a
		{href}
		class={classes}
		class:pointer-events-none={isDisabled}
		aria-busy={loading || undefined}
		aria-disabled={isDisabled || undefined}
		{...rest}
	>
		{@render inner()}
	</a>
{:else}
	<button {type} class={classes} disabled={isDisabled} aria-busy={loading || undefined} {...rest}>
		{@render inner()}
	</button>
{/if}
