<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { cn } from '$lib/utils';

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

<Dialog.Root bind:open>
	<Dialog.Content class={cn('sm:max-w-lg', boxClass)}>
		<Dialog.Header class={title || description ? undefined : 'sr-only'}>
			<Dialog.Title>{title || 'Dialog'}</Dialog.Title>
			{#if description}
				<Dialog.Description>{description}</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="flex flex-col gap-4">
			{@render children?.()}
		</div>
	</Dialog.Content>
</Dialog.Root>
