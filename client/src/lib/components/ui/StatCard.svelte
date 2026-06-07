<script lang="ts">
	/**
	 * StatCard — a single metric tile: a label, a large value, an optional caption,
	 * and a tinted icon badge. The one stat-card design shared across the app (the
	 * admin dashboard and the background-jobs panel) so every metric tile is
	 * visually identical. Built on the canonical tonal panel surface (matches
	 * `AppPanel` / `Card` tone="tonal").
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		title: string;
		value: string | number;
		/** An ICONS registry value, e.g. `lineicons:files`. */
		icon: string;
		caption?: string;
		/** Icon-badge tint (text + bg), e.g. `text-primary-500 bg-primary-500/10`. */
		iconClass?: string;
	}

	let {
		title,
		value,
		icon,
		caption,
		iconClass = 'text-primary-500 bg-primary-500/10'
	}: Props = $props();
</script>

<div class="card border border-surface-200-800 preset-tonal-surface p-4">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-xs text-surface-500">{title}</p>
			<p class="mt-1 text-3xl font-semibold">{value}</p>
			{#if caption}
				<p class="mt-1 text-xs text-surface-500">{caption}</p>
			{/if}
		</div>
		<div class="flex size-10 shrink-0 items-center justify-center rounded-lg {iconClass}">
			<AppIcon name={icon} class="size-5" />
		</div>
	</div>
</div>
