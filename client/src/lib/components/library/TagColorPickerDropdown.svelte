<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils';

	interface Props {
		open: boolean;
		color: string;
		draft: string;
		palette: readonly string[];
		keyId: string;
		title?: string;
		onOpenChange?: (open: boolean) => void;
		onpick?: (color: string) => void;
		onupdateDraft?: (value: string) => void;
		oncommitDraft?: () => void;
	}

	let {
		open,
		color,
		draft,
		palette,
		keyId,
		title = 'Select tag color',
		onOpenChange,
		onpick,
		onupdateDraft,
		oncommitDraft
	}: Props = $props();

	const selected = $derived(color.toUpperCase());

	/**
	 * The caller (routes/(app)/libraries/[id]/tags/+page.svelte) owns `open` as a
	 * one-way controlled prop (only one color picker across the page may be open
	 * at a time, keyed by `keyId`), but bits-ui's Popover is otherwise fully in
	 * charge of opening/closing/dismissal: trigger click, Escape, and
	 * outside-click all flow through `onOpenChange`, which the caller uses to
	 * update its `open` source of truth. This mirrors the ConfirmModal /
	 * AlertDialog.Root pattern — no hand-rolled document listener, no manual
	 * `preventDefault` on the trigger.
	 */
</script>

<div class="relative inline-block" data-color-dropdown>
	<Popover.Root {open} onOpenChange={(next) => onOpenChange?.(next)}>
		<Popover.Trigger
			class="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-accent"
			{title}
		>
			<span class="size-4 rounded-full" style:background-color={color}></span>
		</Popover.Trigger>
		<Popover.Content class="w-52 p-4" align="start">
			<div class="grid grid-cols-4 gap-2">
				{#each palette as entry (`${keyId}-${entry}`)}
					<button
						type="button"
						class={cn(
							'relative size-9 rounded-full border border-border transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40',
							entry === selected && 'ring-2 ring-primary'
						)}
						style:background-color={entry}
						title={entry}
						onclick={() => onpick?.(entry)}
					>
						{#if entry === selected}
							<AppIcon
								name={ICONS.check}
								class="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow"
							/>
						{/if}
					</button>
				{/each}
			</div>
			<Input
				class="mt-2 font-mono uppercase"
				type="text"
				value={draft}
				placeholder="#3B82F6"
				oninput={(e) => onupdateDraft?.(e.currentTarget.value)}
				onblur={() => oncommitDraft?.()}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						oncommitDraft?.();
					}
				}}
			/>
		</Popover.Content>
	</Popover.Root>
</div>
