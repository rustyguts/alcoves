<script lang="ts">
	/**
	 * InspectorPanel — the editor's tabbed side panel.
	 *
	 * Renders a tab bar (with count badges) and a scrollable body filled by the
	 * page's `children` snippet. The page keeps every tab's content MOUNTED and
	 * toggles visibility itself, so switching tabs never resets a panel's
	 * search box or an in-progress form. The page's panel wrappers carry
	 * role="tabpanel" + aria-labelledby={tabId(id)} to complete the pattern.
	 *
	 * The tab bar implements the ARIA tabs pattern: roving tabindex with
	 * ArrowLeft/ArrowRight/Home/End navigation and aria-controls wiring.
	 *
	 * On lg+ the panel is a fixed-width right column with a drag-resizable left
	 * divider — live width is local while dragging and committed (persisted)
	 * once on release; the divider is also keyboard-operable (arrow keys, APG
	 * window-splitter style). Below lg it is a plain full-width section and the
	 * divider hides.
	 */
	import type { Snippet } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
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

	// — tab roving focus —

	let tablistEl = $state<HTMLElement | null>(null);

	function focusTab(id: string) {
		onselecttab?.(id);
		const el = tablistEl?.querySelector<HTMLButtonElement>(`#inspector-tab-${id}`);
		el?.focus();
	}

	function onTabKeydown(e: KeyboardEvent) {
		const ids = tabs.map((t) => t.id);
		const current = ids.indexOf(active);
		if (current < 0 || ids.length === 0) return;
		let next: number | null = null;
		if (e.key === 'ArrowRight') next = (current + 1) % ids.length;
		else if (e.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = ids.length - 1;
		if (next === null) return;
		e.preventDefault();
		e.stopPropagation();
		focusTab(ids[next]!);
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
	class="relative flex w-full min-w-0 flex-col rounded-lg border border-surface-200-800 bg-surface-50-950 lg:w-(--inspector-w) lg:shrink-0 {klass}"
	style="--inspector-w: {renderedWidth}px"
	data-testid="inspector"
>
	<!-- lg-only resize divider on the left edge (pointer drag + arrow keys).
	     A focusable role="separator" with aria-valuenow IS the APG
	     window-splitter pattern; the a11y linter just doesn't know it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none rounded hover:bg-primary-500/40 focus-visible:bg-primary-500/40 focus-visible:outline-none lg:block"
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

	<div
		bind:this={tablistEl}
		class="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-surface-200-800 p-1"
		role="tablist"
		aria-label="Inspector"
	>
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				id="inspector-tab-{tab.id}"
				aria-selected={active === tab.id}
				aria-controls="inspector-panel-{tab.id}"
				tabindex={active === tab.id ? 0 : -1}
				class="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors {active ===
				tab.id
					? 'preset-tonal-primary'
					: 'text-surface-600-400 hover:preset-tonal'}"
				onclick={() => onselecttab?.(tab.id)}
				onkeydown={onTabKeydown}
			>
				<AppIcon name={tab.icon} class="size-3.5" />
				{tab.label}
				{#if tab.count !== undefined && tab.count > 0}
					<span class="badge preset-tonal-surface text-[10px] tabular-nums">{tab.count}</span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto p-3">
		{@render children?.()}
	</div>
</aside>
