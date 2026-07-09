<script lang="ts">
	/**
	 * InspectorPanel — the editor's tabbed side panel.
	 *
	 * Renders a tab bar (with count badges) and a scrollable body filled by the
	 * page's `children` snippet. The page keeps every tab's content MOUNTED
	 * (bits-ui's `Tabs.Content` hides inactive panels via the `hidden` attribute
	 * rather than unmounting them), so switching tabs never resets a panel's
	 * search box or an in-progress form.
	 *
	 * On lg+ the panel is a fixed-width right column with a drag-resizable left
	 * divider — live width is local while dragging and committed (persisted)
	 * once on release; the divider is also keyboard-operable (arrow keys, APG
	 * window-splitter style). Below lg it is a plain full-width section and the
	 * divider hides. No vendored primitive covers a resizable split panel, so
	 * the divider stays hand-rolled.
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { cn } from '$lib/utils';
	import { INSPECTOR_MAX_WIDTH, INSPECTOR_MIN_WIDTH } from '$lib/state/editor-preferences.svelte';

	interface InspectorTabDef {
		id: string;
		label: string;
		icon: string;
		count?: number;
	}

	interface Props {
		tabs: InspectorTabDef[];
		active: string;
		width: number;
		onselecttab?: (id: string) => void;
		onwidthchange?: (width: number) => void;
		class?: string;
		children?: Snippet;
	}

	let {
		tabs,
		active,
		width,
		onselecttab,
		onwidthchange,
		class: klass = '',
		children
	}: Props = $props();

	const KEYBOARD_RESIZE_STEP = 16;

	function clampWidth(value: number): number {
		return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, value));
	}

	// — divider resize —

	interface ResizeState {
		pointerId: number;
		startClientX: number;
		startWidth: number;
	}
	let resize: ResizeState | null = null;
	/** Live width while a pointer drag is in flight; committed on release. */
	let dragWidth = $state<number | null>(null);

	const renderedWidth = $derived(dragWidth ?? width);

	function onDividerDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		e.preventDefault();
		resize = { pointerId: e.pointerId, startClientX: e.clientX, startWidth: width };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function onDividerMove(e: PointerEvent) {
		if (!resize) return;
		// Dragging the LEFT edge of a right-hand column: moving left grows it.
		dragWidth = clampWidth(resize.startWidth + (resize.startClientX - e.clientX));
	}

	function onDividerUp(e: PointerEvent) {
		if (!resize) return;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(resize.pointerId);
		if (dragWidth !== null) onwidthchange?.(dragWidth);
		dragWidth = null;
		resize = null;
	}

	function onDividerKeydown(e: KeyboardEvent) {
		// APG window splitter: arrows move the divider. Left = wider (the panel
		// sits on the right), right = narrower.
		let delta: number;
		if (e.key === 'ArrowLeft') delta = KEYBOARD_RESIZE_STEP;
		else if (e.key === 'ArrowRight') delta = -KEYBOARD_RESIZE_STEP;
		else return;
		e.preventDefault();
		e.stopPropagation();
		onwidthchange?.(clampWidth(width + delta));
	}
</script>

<aside
	class={cn(
		'relative flex w-full min-w-0 flex-col rounded-xl bg-card shadow-xs lg:w-(--inspector-w) lg:shrink-0',
		klass
	)}
	style="--inspector-w: {renderedWidth}px"
	data-testid="inspector"
>
	<!-- lg-only resize divider on the left edge (pointer drag + arrow keys).
	     A focusable role="separator" with aria-valuenow IS the APG
	     window-splitter pattern; the a11y linter just doesn't know it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none rounded hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none lg:block"
		role="separator"
		tabindex="0"
		aria-orientation="vertical"
		aria-label="Resize panel"
		aria-valuemin={INSPECTOR_MIN_WIDTH}
		aria-valuemax={INSPECTOR_MAX_WIDTH}
		aria-valuenow={renderedWidth}
		data-testid="inspector-divider"
		onpointerdown={onDividerDown}
		onpointermove={onDividerMove}
		onpointerup={onDividerUp}
		onpointercancel={onDividerUp}
		onkeydown={onDividerKeydown}
	></div>

	<Tabs.Root
		value={active}
		onValueChange={(v) => onselecttab?.(v)}
		loop
		class="flex min-h-0 flex-1 flex-col gap-0"
	>
		<Tabs.List
			aria-label="Inspector"
			class="w-full shrink-0 justify-start gap-0.5 overflow-x-auto rounded-none bg-transparent p-1"
		>
			{#each tabs as tab (tab.id)}
				<Tabs.Trigger
					value={tab.id}
					class="gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium whitespace-nowrap data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
				>
					<AppIcon name={tab.icon} class="size-3.5" />
					{tab.label}
					{#if tab.count !== undefined && tab.count > 0}
						<Badge variant="secondary" class="h-4 px-1 text-[10px] tabular-nums">
							{tab.count}
						</Badge>
					{/if}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		<div class="min-h-0 flex-1 overflow-y-auto p-3">
			{@render children?.()}
		</div>
	</Tabs.Root>
</aside>
