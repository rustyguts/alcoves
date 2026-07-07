<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';

	interface Props {
		title: string;
		message: string;
		confirmLabel: string;
		confirmClass?: string;
		confirmIcon?: string;
		pending?: boolean;
		open?: boolean;
		onconfirm?: () => void;
		/**
		 * Fired when the dialog is dismissed without confirming (Cancel button,
		 * Escape, backdrop). Callers that drive `open` from derived state (rather
		 * than bind:open) need this to reset their source of truth.
		 */
		oncancel?: () => void;
	}

	let {
		title,
		message,
		confirmLabel,
		confirmClass = '',
		confirmIcon = ICONS.check,
		pending = false,
		open = $bindable(false),
		onconfirm,
		oncancel
	}: Props = $props();

	// Map the legacy Nuxt UI `confirmClass` hint onto a Button color, the same
	// substring matching the Vue original used to derive its UButton color. The
	// Button renders `preset-filled-{color}-500` — byte-equivalent to the prior
	// hand-rolled preset string.
	const confirmColor = $derived.by<'primary' | 'surface' | 'error' | 'warning' | 'success'>(() => {
		const c = confirmClass;
		if (c.includes('error')) return 'error';
		if (c.includes('warning')) return 'warning';
		if (c.includes('success')) return 'success';
		if (c.includes('neutral')) return 'surface';
		return 'primary';
	});
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		open = e.open;
		if (!e.open) oncancel?.();
	}}
>
	<Dialog.Backdrop class="fixed inset-0 z-40 bg-surface-950/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<Dialog.Content
			class="flex w-full max-w-md flex-col gap-4 card rounded-lg preset-filled-surface-50-950 p-6 shadow-xl"
		>
			<header class="flex flex-col gap-1">
				<Dialog.Title class="text-lg font-semibold">{title}</Dialog.Title>
				<Dialog.Description class="text-sm text-surface-600-400">{message}</Dialog.Description>
			</header>
			<footer class="flex w-full justify-end gap-2">
				<Button
					variant="tonal"
					color="surface"
					disabled={pending}
					onclick={() => {
						open = false;
						oncancel?.();
					}}
				>
					Cancel
				</Button>
				<Button color={confirmColor} loading={pending} onclick={() => onconfirm?.()}>
					{#snippet icon()}
						<AppIcon name={confirmIcon} class="size-4" />
					{/snippet}
					{confirmLabel}
				</Button>
			</footer>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
