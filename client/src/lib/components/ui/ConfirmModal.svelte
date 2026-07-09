<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
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

	// Legacy callers pass Skeleton-era hints ("error"/"btn-error"/"btn-soft
	// btn-error") to flag a destructive action; map those onto the vendored
	// Button's `destructive` variant. Everything else (including the old
	// warning/success/neutral hints, which have no standalone destructive-free
	// shadcn Button variant) uses the default/primary treatment.
	const confirmVariant = $derived(confirmClass.includes('error') ? 'destructive' : 'default');
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(next) => {
		open = next;
		if (!next) oncancel?.();
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>{message}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<!--
				bits-ui's AlertDialogCancelState consumes `disabled` purely to gate
				its internal onclick/onkeydown close handler; it does NOT reflect it
				as a DOM/aria attribute (unlike Action), so the native
				`disabled:opacity-50` button styling never kicks in on its own — add
				the visual treatment by hand to match Action's disabled look.
			-->
			<AlertDialog.Cancel
				disabled={pending}
				class={pending ? 'pointer-events-none opacity-50' : ''}
			>
				Cancel
			</AlertDialog.Cancel>
			<AlertDialog.Action variant={confirmVariant} disabled={pending} onclick={() => onconfirm?.()}>
				{#if pending}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={confirmIcon} class="size-4" />
				{/if}
				{confirmLabel}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
