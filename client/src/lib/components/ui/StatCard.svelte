<script lang="ts">
	/**
	 * StatCard — a single metric tile: a label, a large value, an optional caption,
	 * and a tinted icon badge. The one stat-card design shared across the app (the
	 * admin dashboard and the background-jobs panel) so every metric tile is
	 * visually identical. A lightweight card surface (`bg-card` + `border`) rather
	 * than the full `Card` composition, matching `AppPanel`.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';

	interface Props {
		title: string;
		value: string | number;
		/** An ICONS registry value, e.g. `lineicons:files`. */
		icon: string;
		caption?: string;
		/** Icon-badge tint (text + bg), e.g. `text-primary bg-primary/10`. */
		iconClass?: string;
	}

	let { title, value, icon, caption, iconClass = 'text-primary bg-primary/10' }: Props = $props();
</script>

<div data-slot="stat-card" class="rounded-lg border bg-card p-4 text-card-foreground">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-xs text-muted-foreground">{title}</p>
			<p class="mt-1 text-3xl font-semibold">{value}</p>
			{#if caption}
				<p class="mt-1 text-xs text-muted-foreground">{caption}</p>
			{/if}
		</div>
		<div
			data-slot="stat-card-icon"
			class="flex size-10 shrink-0 items-center justify-center rounded-lg {iconClass}"
		>
			<AppIcon name={icon} class="size-5" />
		</div>
	</div>
</div>
