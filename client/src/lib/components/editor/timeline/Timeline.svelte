<script lang="ts">
	/**
	 * Timeline — the multi-track timeline container.
	 *
	 * Composes TimelineControls + (scrollable) TimelineRuler, MomentsTrack,
	 * MarkersTrack and the sticky WaveformTrack. Owns the view state (zoom 1–50,
	 * scrollLeft, viewport width) and the batch-save model: drags/nudges land in
	 * `pendingChanges` (warning-styled, not saved), "Save changes" commits them
	 * all via `onsavePending`, and a reconcile effect drops entries once the
	 * server values match (±1ms). An imperative controller is handed up through
	 * `oncontroller` so the global keyboard shortcuts can zoom/scroll/center and
	 * the page can read effective ranges (for split/I/O) and clear pending state
	 * after immediate saves.
	 *
	 * No keydown listeners here — keyboard input is owned by the page's single
	 * shortcut map (editor-shortcuts.ts).
	 */
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import type { Moment } from '$lib/types/api';
	import {
		pxPerSecond,
		type TimeRange,
		type TimelineController,
		type TimelineMarker
	} from '$lib/utils/timeline-geometry';
	import TimelineControls from './TimelineControls.svelte';
	import TimelineRuler from './TimelineRuler.svelte';
	import MomentsTrack from './MomentsTrack.svelte';
	import MarkersTrack from './MarkersTrack.svelte';
	import WaveformTrack from './WaveformTrack.svelte';

	interface Props {
		duration: number;
		currentTime: number;
		moments: Moment[];
		selectedId?: string | null;
		waveformPeaks?: number[] | null;
		waveformPeaksPerSecond?: number | null;
		markers?: TimelineMarker[];
		snapping?: boolean;
		onseek?: (seconds: number) => void;
		onselectMoment?: (momentId: string) => void;
		onsavePending?: (
			changes: Array<{ id: string; startSeconds: number; endSeconds: number }>
		) => Promise<void> | void;
		oncreateMoment?: () => void;
		onsplit?: () => void;
		ontogglesnap?: () => void;
		ondirtychange?: (count: number) => void;
		oncontroller?: (controller: TimelineController) => void;
	}

	let {
		duration,
		currentTime,
		moments,
		selectedId = null,
		waveformPeaks = null,
		waveformPeaksPerSecond = null,
		markers = [],
		snapping = false,
		onseek,
		onselectMoment,
		onsavePending,
		oncreateMoment,
		onsplit,
		ontogglesnap,
		ondirtychange,
		oncontroller
	}: Props = $props();

	const MIN_ZOOM = 1;
	const MAX_ZOOM = 50;
	const ZOOM_STEP = 1.5;
	const SCROLL_STEP_FRACTION = 0.25;
	const FLOAT_EPSILON = 0.001;

	let scrollEl = $state<HTMLElement | null>(null);
	let containerWidth = $state(0);
	let scrollLeft = $state(0);
	let zoom = $state(1);
	let dragActive = $state(false);
	let savingPending = $state(false);

	let pendingChanges = $state<Record<string, TimeRange>>({});

	const hasWaveform = $derived(
		Array.isArray(waveformPeaks) && waveformPeaks.length > 0 && (waveformPeaksPerSecond ?? 0) > 0
	);

	const innerWidth = $derived(Math.max(0, containerWidth * zoom));
	const pxPerSec = $derived(pxPerSecond(containerWidth, zoom, duration));
	const playheadLeftPx = $derived(currentTime * pxPerSec);

	const pendingCount = $derived(Object.keys(pendingChanges).length);

	function effectiveRange(m: Moment): TimeRange {
		return pendingChanges[m.id] ?? { startSeconds: m.startSeconds, endSeconds: m.endSeconds };
	}

	// Split is possible when the playhead sits strictly inside the selected
	// moment's effective range, leaving ≥0.05s on both sides.
	const cansplit = $derived.by(() => {
		const m = moments.find((x) => x.id === selectedId);
		if (!m) return false;
		const eff = effectiveRange(m);
		return currentTime - eff.startSeconds >= 0.05 && eff.endSeconds - currentTime >= 0.05;
	});

	// Reconcile pending entries against the server list: drop entries whose
	// values the server now matches (the save landed) and entries whose moment
	// no longer exists at all (deleted under the drag — otherwise the dirty
	// count, Save button and navigation guard get stuck on an orphan).
	$effect(() => {
		const list = moments;
		const ids = new Set(list.map((m) => m.id));
		const next = { ...pendingChanges };
		let changed = false;
		for (const id of Object.keys(next)) {
			if (!ids.has(id)) {
				delete next[id];
				changed = true;
			}
		}
		for (const m of list) {
			const p = next[m.id];
			if (
				p &&
				Math.abs(p.startSeconds - m.startSeconds) < FLOAT_EPSILON &&
				Math.abs(p.endSeconds - m.endSeconds) < FLOAT_EPSILON
			) {
				delete next[m.id];
				changed = true;
			}
		}
		if (changed) pendingChanges = next;
	});

	// Surface the dirty count so the page can guard navigation.
	$effect(() => {
		ondirtychange?.(pendingCount);
	});

	function onPendingChange(momentId: string, range: TimeRange) {
		pendingChanges = { ...pendingChanges, [momentId]: range };
	}

	async function savePending() {
		const changes = Object.entries(pendingChanges).map(([id, p]) => ({
			id,
			startSeconds: p.startSeconds,
			endSeconds: p.endSeconds
		}));
		if (changes.length === 0) return;
		// Keep the entries until the save settles: on success the reconcile
		// effect drops them as the server echoes the new values; on failure the
		// user's drag edits stay dirty and recoverable instead of silently
		// snapping back to the old server values.
		savingPending = true;
		try {
			await onsavePending?.(changes);
		} finally {
			savingPending = false;
		}
	}

	// — zoom / scroll —

	function zoomAt(factor: number) {
		const sc = scrollEl;
		const prevPxPerSec = pxPerSec;
		const playheadScreenX = playheadLeftPx - (sc?.scrollLeft ?? 0);

		const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
		if (next === zoom) return;
		zoom = next;

		// Keep the playhead at the same screen x. The DOM scrollLeft write is
		// deferred a microtask because innerWidth's CSS update lands after
		// Svelte flushes the reactive change.
		const target = prevPxPerSec === 0 ? 0 : currentTime * pxPerSec - playheadScreenX;
		scrollLeft = Math.max(0, target);

		void Promise.resolve().then(() => {
			const scEl = scrollEl;
			if (!scEl) return;
			scEl.scrollLeft = scrollLeft;
		});
	}

	function zoomIn() {
		zoomAt(ZOOM_STEP);
	}

	function zoomOut() {
		zoomAt(1 / ZOOM_STEP);
	}

	function zoomToFit() {
		zoom = 1;
		scrollLeft = 0;
		if (scrollEl) scrollEl.scrollLeft = 0;
	}

	function centerPlayhead() {
		const sc = scrollEl;
		if (!sc) return;
		sc.scrollTo({ left: playheadLeftPx - sc.clientWidth / 2, behavior: 'smooth' });
	}

	function scrollStep(direction: -1 | 1) {
		const sc = scrollEl;
		if (!sc) return;
		sc.scrollBy({ left: sc.clientWidth * SCROLL_STEP_FRACTION * direction, behavior: 'smooth' });
	}

	function onWheel(e: WheelEvent) {
		const sc = scrollEl;
		if (!sc) return;
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
			return;
		}
		const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (delta === 0) return;
		e.preventDefault();
		sc.scrollLeft += delta;
	}

	// Auto-follow must yield to the user: any scroll the follow effect didn't
	// write itself counts as manual and suspends following briefly, so zoomed
	// playback can't fight the user's wheel/trackpad.
	const USER_SCROLL_GRACE_MS = 1500;
	let programmaticScroll = false;
	let lastUserScrollAt = 0;

	function onScroll() {
		if (!scrollEl) return;
		scrollLeft = scrollEl.scrollLeft;
		if (programmaticScroll) programmaticScroll = false;
		else lastUserScrollAt = performance.now();
	}

	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (!scrollEl) return;
		containerWidth = scrollEl.clientWidth;
		resizeObserver = new ResizeObserver(() => {
			if (scrollEl) containerWidth = scrollEl.clientWidth;
		});
		resizeObserver.observe(scrollEl);
		scrollEl.addEventListener('wheel', onWheel, { passive: false });
		scrollEl.addEventListener('scroll', onScroll, { passive: true });
	});

	onDestroy(() => {
		if (!browser) return;
		resizeObserver?.disconnect();
		resizeObserver = null;
		scrollEl?.removeEventListener('wheel', onWheel);
		scrollEl?.removeEventListener('scroll', onScroll);
	});

	// Auto-follow playhead while zoomed in — but never yank the viewport while
	// the user is mid-drag, mid-scrub, or just scrolled somewhere on purpose.
	$effect(() => {
		void currentTime;
		void pxPerSec;
		void containerWidth;
		const sc = scrollEl;
		if (!sc || zoom <= 1 || dragActive) return;
		if (performance.now() - lastUserScrollAt < USER_SCROLL_GRACE_MS) return;
		const screenX = playheadLeftPx - sc.scrollLeft;
		const margin = 40;
		if (screenX < margin || screenX > sc.clientWidth - margin) {
			const target = Math.max(0, playheadLeftPx - sc.clientWidth / 2);
			scrollLeft = target;
			programmaticScroll = true;
			sc.scrollLeft = target;
		}
	});

	// Hand the imperative controller to the page (for the global shortcuts and
	// the split/I/O effective-range reads).
	$effect(() => {
		oncontroller?.({
			zoomIn,
			zoomOut,
			zoomToFit,
			scrollStep,
			centerPlayhead,
			getEffectiveRange: (momentId: string) => {
				const m = moments.find((x) => x.id === momentId);
				if (!m) return null;
				const eff = pendingChanges[momentId];
				return eff ? { ...eff } : { startSeconds: m.startSeconds, endSeconds: m.endSeconds };
			},
			clearPending: (momentId: string) => {
				if (!(momentId in pendingChanges)) return;
				const next = { ...pendingChanges };
				delete next[momentId];
				pendingChanges = next;
			},
			hasPending: () => Object.keys(pendingChanges).length > 0
		});
	});
</script>

<div class="select-none" data-testid="timeline">
	<TimelineControls
		{currentTime}
		{duration}
		{zoom}
		{snapping}
		{cansplit}
		{pendingCount}
		saving={savingPending}
		onzoomin={zoomIn}
		onzoomout={zoomOut}
		onzoomfit={zoomToFit}
		ontogglesnap={() => ontogglesnap?.()}
		onsplit={() => onsplit?.()}
		oncreate={() => oncreateMoment?.()}
		onsave={savePending}
	/>

	<div bind:this={scrollEl} class="timeline-scroll overflow-x-scroll overflow-y-hidden">
		<div class="relative" style="width: {innerWidth}px;">
			<TimelineRuler
				{duration}
				{pxPerSec}
				{playheadLeftPx}
				{onseek}
				onscrubchange={(active) => (dragActive = active)}
			/>

			<div class="overflow-hidden rounded-b-lg border border-surface-300-700 bg-surface-100-900">
				<MomentsTrack
					{moments}
					{selectedId}
					{duration}
					{pxPerSec}
					{currentTime}
					pending={pendingChanges}
					{snapping}
					{playheadLeftPx}
					onpendingchange={onPendingChange}
					onselect={(id) => onselectMoment?.(id)}
					{onseek}
					ondragactive={(active) => (dragActive = active)}
				/>

				{#if markers.length > 0}
					<MarkersTrack {markers} {pxPerSec} {onseek} />
				{/if}

				{#if hasWaveform}
					<WaveformTrack
						peaks={waveformPeaks ?? []}
						peaksPerSecond={waveformPeaksPerSecond ?? 50}
						{duration}
						{pxPerSec}
						{scrollLeft}
						viewportWidth={containerWidth}
						{playheadLeftPx}
						{onseek}
						onscrubchange={(active) => (dragActive = active)}
					/>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.timeline-scroll {
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.timeline-scroll::-webkit-scrollbar {
		display: none;
	}
</style>
