<script lang="ts">
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	interface Props {
		title: string;
		subtitle: string;
		error?: string;
		children?: Snippet;
		footer?: Snippet;
	}

	let { title, subtitle, error = '', children, footer }: Props = $props();
</script>

<div class="flex min-h-svh items-center justify-center bg-surface-50-950 p-4">
	<div class="w-full max-w-md">
		<!-- The auth box is intentionally elevated (a focused, floating panel),
			 unlike the flat tonal panels used for in-page content. -->
		<div
			class="card rounded-lg preset-filled-surface-100-900 p-6 shadow-lg ring ring-surface-200-800"
		>
			<div class="mb-6 flex flex-col items-center gap-3">
				<img src="/logo.webp" alt="Alcoves" width="72" height="72" class="rounded-xl" />
				<h2 class="text-2xl font-bold text-surface-950-50">{title}</h2>
				<p class="text-center text-sm opacity-75">{subtitle}</p>
			</div>

			{#if error}
				<div class="mb-4 flex items-center gap-2 card preset-tonal-error p-3 text-sm" role="alert">
					<AppIcon name={ICONS.error} class="size-4 shrink-0" />
					<span>{error}</span>
				</div>
			{/if}

			{@render children?.()}

			{#if footer}
				<div class="mt-6 border-t border-surface-200-800 pt-4">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
</div>
