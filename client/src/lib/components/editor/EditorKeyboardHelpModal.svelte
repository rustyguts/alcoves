<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Kbd, KbdGroup } from '$lib/components/ui/kbd/index.js';

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

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Keyboard shortcuts</Dialog.Title>
		</Dialog.Header>

		<div class="flex max-h-[60svh] flex-col gap-5 overflow-y-auto">
			{#each sections as section (section.title)}
				<section>
					<p class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{section.title}
					</p>
					<ul class="flex flex-col gap-1.5">
						{#each section.items as item (item.description)}
							<li class="flex items-center justify-between gap-4 text-sm">
								<span>{item.description}</span>
								<KbdGroup>
									{#each item.keys as k (k)}
										<Kbd>{k}</Kbd>
									{/each}
								</KbdGroup>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>
