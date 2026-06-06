<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
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
	}

	let {
		title,
		message,
		confirmLabel,
		confirmClass = '',
		confirmIcon = ICONS.check,
		pending = false,
		open = $bindable(false),
		onconfirm
	}: Props = $props();

	// Map the legacy Nuxt UI `confirmClass` hint onto a Skeleton preset color, the
	// same substring matching the Vue original used to derive its UButton color.
	const confirmPreset = $derived.by(() => {
		const c = confirmClass;
		if (c.includes('error')) return 'preset-filled-error-500';
		if (c.includes('warning')) return 'preset-filled-warning-500';
		if (c.includes('success')) return 'preset-filled-success-500';
		if (c.includes('neutral')) return 'preset-filled-surface-500';
		return 'preset-filled-primary-500';
	});
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Backdrop class="fixed inset-0 z-40 bg-surface-950/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<Dialog.Content
			class="flex w-full max-w-md flex-col gap-4 card rounded-lg preset-filled-surface-50-950 p-6 shadow-xl"
		>
			<header class="flex flex-col gap-1">
				<Dialog.Title class="text-lg font-semibold">{title}</Dialog.Title>
				<Dialog.Description class="text-sm opacity-75">{message}</Dialog.Description>
			</header>
			<footer class="flex w-full justify-end gap-2">
				<button
					type="button"
					class="btn preset-tonal-surface"
					disabled={pending}
					onclick={() => (open = false)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn {confirmPreset}"
					disabled={pending}
					onclick={() => onconfirm?.()}
				>
					{#if pending}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={confirmIcon} class="size-4" />
					{/if}
					{confirmLabel}
				</button>
			</footer>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
