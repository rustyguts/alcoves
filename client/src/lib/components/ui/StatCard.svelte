<script lang="ts">
	/**
	 * StatCard — a single metric tile: a label, a large value, an optional
	 * caption, and a small unboxed icon accent. The one stat-card design
	 * shared across the app (the admin dashboard and the background-jobs
	 * panel) so every metric tile is visually identical. Flat redesign: a
	 * borderless sheet (`bg-card shadow-xs rounded-xl`, no `border`) with the
	 * big number carrying the visual weight — no tinted icon "chrome box".
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { cn } from '$lib/utils';

	interface Props {
		title: string;
		value: string | number;
		/** An ICONS registry value, e.g. `lineicons:files`. */
		icon: string;
		caption?: string;
		/** Icon accent color, e.g. `text-primary`. */
		iconClass?: string;
	}

	let { title, value, icon, caption, iconClass = 'text-muted-foreground' }: Props = $props();
</script>

<div data-slot="stat-card" class="rounded-xl bg-card p-4 text-card-foreground shadow-xs">
	<div class="flex items-start justify-between gap-3">
		<p class="text-xs text-muted-foreground">{title}</p>
		<AppIcon name={icon} data-slot="stat-card-icon" class={cn('size-4 shrink-0', iconClass)} />
	</div>
	<p class="mt-1 text-3xl font-semibold">{value}</p>
	{#if caption}
		<p class="mt-1 text-xs text-muted-foreground">{caption}</p>
	{/if}
</div>
