<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	interface Props {
		title?: string;
		description?: string;
		/** Extra classes merged onto the modal content box. */
		boxClass?: string;
		/** Controlled visibility (two-way bindable). */
		open?: boolean;
		/** Default slot — the modal body. */
		children?: Snippet;
	}

	let {
		title = '',
		description = '',
		boxClass = '',
		open = $bindable(false),
		children
	}: Props = $props();
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Backdrop class="fixed inset-0 z-40 bg-surface-950/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<Dialog.Content
			class="relative flex w-full max-w-lg flex-col gap-4 card rounded-lg preset-filled-surface-50-950 p-6 shadow-xl {boxClass}"
		>
			{#if title || description}
				<header class="flex flex-col gap-1">
					{#if title}
						<Dialog.Title class="text-lg font-semibold">{title}</Dialog.Title>
					{/if}
					{#if description}
						<Dialog.Description class="text-sm opacity-75">{description}</Dialog.Description>
					{/if}
				</header>
			{/if}

			<Dialog.CloseTrigger class="absolute top-4 right-4 btn-icon preset-tonal" aria-label="Close">
				<AppIcon name={ICONS.close} class="size-4" />
			</Dialog.CloseTrigger>

			<div class="flex flex-col gap-4">
				{@render children?.()}
			</div>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
