<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	interface Props {
		/** Controlled visibility (two-way bindable). */
		open?: boolean;
	}

	let { open = $bindable(false) }: Props = $props();

	interface Shortcut {
		keys: string[];
		description: string;
	}

	const sections: { title: string; items: Shortcut[] }[] = [
		{
			title: 'Playback',
			items: [
				{ keys: ['Space', 'K'], description: 'Play / pause' },
				{ keys: ['J', '←'], description: 'Jump back 5s' },
				{ keys: ['L', '→'], description: 'Jump forward 5s' },
				{ keys: [','], description: 'Step back ~1 frame' },
				{ keys: ['.'], description: 'Step forward ~1 frame' },
				{ keys: ['R'], description: 'Loop the selected moment' }
			]
		},
		{
			title: 'Moments',
			items: [
				{ keys: ['M', 'N'], description: 'New moment at playhead' },
				{ keys: ['I'], description: 'Set selected moment start to playhead' },
				{ keys: ['O'], description: 'Set selected moment end to playhead' },
				{ keys: ['S'], description: 'Split selected moment at playhead' },
				{ keys: ['Del', '⌫'], description: 'Delete selected moment' },
				{ keys: ['←', '→'], description: 'Nudge a focused bar ~1 frame (Shift = 1s)' }
			]
		},
		{
			title: 'Timeline',
			items: [
				{ keys: ['Z', '+'], description: 'Zoom in' },
				{ keys: ['X', '-'], description: 'Zoom out' },
				{ keys: ['F'], description: 'Zoom to fit' },
				{ keys: ['A'], description: 'Scroll left' },
				{ keys: ['D'], description: 'Scroll right' },
				{ keys: ['C'], description: 'Center on playhead' },
				{ keys: ['G'], description: 'Toggle snapping' },
				{ keys: ['?'], description: 'Open this reference' }
			]
		}
	];
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Dialog.Backdrop class="fixed inset-0 z-40 bg-surface-950/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<Dialog.Content class="relative w-full max-w-lg space-y-4 card bg-surface-50-950 p-6 shadow-xl">
			<header class="flex items-center justify-between">
				<Dialog.Title class="text-lg font-semibold">Keyboard shortcuts</Dialog.Title>
				<Dialog.CloseTrigger class="btn-icon preset-tonal" aria-label="Close">
					<AppIcon name={ICONS.close} class="size-4" />
				</Dialog.CloseTrigger>
			</header>

			<div class="flex max-h-[60svh] flex-col gap-5 overflow-y-auto">
				{#each sections as section (section.title)}
					<section>
						<p class="mb-2 text-xs font-semibold tracking-wide uppercase opacity-60">
							{section.title}
						</p>
						<ul class="flex flex-col gap-1.5">
							{#each section.items as item (item.description)}
								<li class="flex items-center justify-between gap-4 text-sm">
									<span>{item.description}</span>
									<span class="flex items-center gap-1">
										{#each item.keys as k (k)}
											<kbd
												class="rounded border border-surface-300-700 bg-surface-200-800 px-1.5 py-0.5 font-mono text-[11px]"
											>
												{k}
											</kbd>
										{/each}
									</span>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
