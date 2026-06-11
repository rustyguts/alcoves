<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { Moment } from '$lib/types/api';
	import { createWaveformRenderer } from '$lib/state/waveform-renderer';

	interface Props {
		duration: number;
		currentTime: number;
		moments: Moment[];
		selectedId?: string | null;
		waveformPeaks?: number[] | null;
		waveformPeaksPerSecond?: number | null;
		onseek?: (seconds: number) => void;
		onselectMoment?: (momentId: string) => void;
		onsavePending?: (
			changes: Array<{ id: string; startSeconds: number; endSeconds: number }>
		) => void;
		oncreateMoment?: () => void;
		onopenShortcuts?: () => void;
	}

	let {
		duration,
		currentTime,
		moments,
		selectedId = null,
		waveformPeaks = null,
		waveformPeaksPerSecond = null,
		onseek,
		onselectMoment,
		onsavePending,
		oncreateMoment,
		onopenShortcuts
	}: Props = $props();

	let scrollEl = $state<HTMLElement | null>(null);
	let trackEl = $state<HTMLElement | null>(null);
	let rulerEl = $state<HTMLElement | null>(null);
	let waveformCanvas = $state<HTMLCanvasElement | null>(null);
	let waveformRowEl = $state<HTMLElement | null>(null);
	let containerWidth = $state(0);
	let scrollLeft = $state(0);
	let zoom = $state(1);

	const WAVEFORM_HEIGHT = 56;
	const hasWaveform = $derived(
		Array.isArray(waveformPeaks) && waveformPeaks.length > 0 && (waveformPeaksPerSecond ?? 0) > 0
	);

	const MIN_ZOOM = 1;
	const MAX_ZOOM = 50;
	const ZOOM_STEP = 1.5;
	const SCROLL_STEP_FRACTION = 0.25;
	const MIN_MOMENT_SECONDS = 0.05;

	interface Pending {
		startSeconds: number;
		endSeconds: number;
	}

	let pendingChanges = $state<Record<string, Pending>>({});
	let savingPending = $state(false);

	const hasPending = $derived(Object.keys(pendingChanges).length > 0);

	function effective(m: Moment): Pending {
		return (
			pendingChanges[m.id] ?? {
				startSeconds: m.startSeconds,
				endSeconds: m.endSeconds
			}
		);
	}

	function isDirty(id: string): boolean {
		return id in pendingChanges;
	}

	interface MomentStatus {
		kind: 'not_processed' | 'processing' | 'processed' | 'failed';
		label: string;
		progress: number | null;
	}

	function momentStatus(m: Moment): MomentStatus {
		if (m.exportStatus === 'ready' && m.exportedVersion === m.exportVersion) {
			return { kind: 'processed', label: 'Processed', progress: null };
		}
		if (m.exportStatus === 'failed') {
			return { kind: 'failed', label: 'Failed', progress: null };
		}
		if (m.exportStatus === 'queued' || m.exportStatus === 'processing') {
			return {
				kind: 'processing',
				label:
					m.exportProgress != null ? `Processing ${Math.round(m.exportProgress)}%` : 'Processing',
				progress: m.exportProgress
			};
		}
		return { kind: 'not_processed', label: 'Not processed', progress: null };
	}

	function shouldShowStatusPill(m: Moment): boolean {
		const eff = effective(m);
		return (eff.endSeconds - eff.startSeconds) * pxPerSec > 120;
	}

	const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 6; // radius 6 in viewBox 16

	function progressDashArray(progress: number | null): string {
		const p = Math.max(0, Math.min(100, progress ?? 0));
		const filled = (p / 100) * CIRCLE_CIRCUMFERENCE;
		return `${filled} ${CIRCLE_CIRCUMFERENCE}`;
	}

	// When server sends new moment values (after save), drop matching pending entries.
	const FLOAT_EPSILON = 0.001;
	$effect(() => {
		const list = moments;
		const next = { ...pendingChanges };
		let changed = false;
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

	const innerWidth = $derived(Math.max(0, containerWidth * zoom));
	const pxPerSec = $derived(duration > 0 ? innerWidth / duration : 0);

	const playheadLeftPx = $derived(currentTime * pxPerSec);

	const waveformRenderer = createWaveformRenderer({
		getCanvas: () => waveformCanvas,
		getPeaks: () => waveformPeaks,
		getPeaksPerSecond: () => waveformPeaksPerSecond ?? 50,
		getPxPerSec: () => pxPerSec,
		getScrollLeft: () => scrollLeft,
		getViewportWidth: () => containerWidth,
		getHeight: () => WAVEFORM_HEIGHT
	});

	// Mirror the Vue `useWaveformRenderer` watch (immediate + flush:'post'):
	// redraw whenever any reactive input — including the canvas mount — changes.
	$effect(() => {
		// touch the reactive deps so the effect re-runs on any of them
		void waveformCanvas;
		void waveformPeaks;
		void waveformPeaksPerSecond;
		void pxPerSec;
		void scrollLeft;
		void containerWidth;
		waveformRenderer.redraw();
	});

	function momentStylePx(m: Moment): string {
		const eff = effective(m);
		const left = eff.startSeconds * pxPerSec;
		const width = Math.max(2, (eff.endSeconds - eff.startSeconds) * pxPerSec);
		return `left: ${left}px; width: ${width}px;`;
	}

	type DragMode = 'move' | 'start' | 'end';
	interface DragState {
		mode: DragMode;
		momentId: string;
		startClientX: number;
		initial: Pending;
		moved: boolean;
	}
	let drag: DragState | null = null;

	function beginDrag(mode: DragMode, m: Moment, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		onselectMoment?.(m.id);
		drag = {
			mode,
			momentId: m.id,
			startClientX: event.clientX,
			initial: effective(m),
			moved: false
		};
		window.addEventListener('mousemove', onDragMove);
		window.addEventListener('mouseup', onDragEnd);
	}

	function onDragMove(event: MouseEvent) {
		if (!drag || pxPerSec === 0) return;
		const dxPx = event.clientX - drag.startClientX;
		const dxSec = dxPx / pxPerSec;
		if (Math.abs(dxPx) > 2) drag.moved = true;

		const { initial, mode, momentId } = drag;
		let start = initial.startSeconds;
		let end = initial.endSeconds;
		const dur = duration;

		if (mode === 'move') {
			const len = end - start;
			start = Math.max(0, Math.min(dur - len, initial.startSeconds + dxSec));
			end = start + len;
		} else if (mode === 'start') {
			start = Math.max(0, Math.min(end - MIN_MOMENT_SECONDS, initial.startSeconds + dxSec));
		} else {
			end = Math.min(dur, Math.max(start + MIN_MOMENT_SECONDS, initial.endSeconds + dxSec));
		}

		pendingChanges = {
			...pendingChanges,
			[momentId]: { startSeconds: start, endSeconds: end }
		};
	}

	function onDragEnd() {
		window.removeEventListener('mousemove', onDragMove);
		window.removeEventListener('mouseup', onDragEnd);
		// Suppress click from bubbling to track (prevents seek) after drag.
		if (drag?.moved) {
			const suppress = (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
				window.removeEventListener('click', suppress, true);
			};
			window.addEventListener('click', suppress, true);
		}
		drag = null;
	}

	function savePending() {
		const changes = Object.entries(pendingChanges).map(([id, p]) => ({
			id,
			startSeconds: p.startSeconds,
			endSeconds: p.endSeconds
		}));
		if (changes.length === 0) return;
		savingPending = true;
		pendingChanges = {};
		try {
			onsavePending?.(changes);
		} finally {
			savingPending = false;
		}
	}

	function onTrackClick(event: MouseEvent) {
		const el = trackEl;
		if (!el || !duration) return;
		const rect = el.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const seconds = (x / innerWidth) * duration;
		onseek?.(Math.max(0, Math.min(duration, seconds)));
	}

	function onRulerClick(event: MouseEvent) {
		const el = rulerEl;
		if (!el || !duration) return;
		const rect = el.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const seconds = (x / innerWidth) * duration;
		onseek?.(Math.max(0, Math.min(duration, seconds)));
	}

	function onWaveformClick(event: MouseEvent) {
		const el = waveformRowEl;
		if (!el || !duration || pxPerSec <= 0) return;
		const rect = el.getBoundingClientRect();
		// waveform row is sticky-pinned; its rect.left is viewport-left of scrollEl,
		// so x is in viewport coords — add scrollLeft to recover timeline position.
		const x = event.clientX - rect.left;
		const seconds = (scrollLeft + x) / pxPerSec;
		onseek?.(Math.max(0, Math.min(duration, seconds)));
	}

	function zoomAt(factor: number) {
		const sc = scrollEl;
		const prevPxPerSec = pxPerSec;
		const playheadScreenX = playheadLeftPx - (sc?.scrollLeft ?? 0);

		const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
		if (next === zoom) return;
		zoom = next;

		// Compute and apply the new scroll target so the waveform canvas redraws
		// with matching pxPerSec + scrollLeft. The DOM-level scrollLeft set is
		// deferred to a microtask because innerWidth's CSS width update happens
		// after Svelte flushes the reactive change.
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

	function scrollToPlayhead() {
		const sc = scrollEl;
		if (!sc) return;
		sc.scrollTo({
			left: playheadLeftPx - sc.clientWidth / 2,
			behavior: 'smooth'
		});
	}

	function scrollStep(direction: -1 | 1) {
		const sc = scrollEl;
		if (!sc) return;
		const step = sc.clientWidth * SCROLL_STEP_FRACTION * direction;
		sc.scrollBy({ left: step, behavior: 'smooth' });
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

	function onKeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target && /input|textarea|select/i.test(target.tagName)) return;
		if (target?.isContentEditable) return;
		switch (e.key.toLowerCase()) {
			case 'z':
				zoomIn();
				e.preventDefault();
				break;
			case 'x':
				zoomOut();
				e.preventDefault();
				break;
			case 'a':
				scrollStep(-1);
				e.preventDefault();
				break;
			case 'd':
				scrollStep(1);
				e.preventDefault();
				break;
			case 'c':
				scrollToPlayhead();
				e.preventDefault();
				break;
		}
	}

	let resizeObserver: ResizeObserver | null = null;

	function onScroll() {
		if (scrollEl) scrollLeft = scrollEl.scrollLeft;
	}

	onMount(() => {
		if (!scrollEl) return;
		containerWidth = scrollEl.clientWidth;
		resizeObserver = new ResizeObserver(() => {
			if (scrollEl) containerWidth = scrollEl.clientWidth;
		});
		resizeObserver.observe(scrollEl);
		scrollEl.addEventListener('wheel', onWheel, { passive: false });
		scrollEl.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('keydown', onKeydown);
	});

	onDestroy(() => {
		if (!browser) return;
		resizeObserver?.disconnect();
		resizeObserver = null;
		scrollEl?.removeEventListener('wheel', onWheel);
		scrollEl?.removeEventListener('scroll', onScroll);
		window.removeEventListener('keydown', onKeydown);
	});

	// Auto-follow playhead while zoomed in: keep it inside viewport.
	$effect(() => {
		// re-run when currentTime / pxPerSec / containerWidth change
		void currentTime;
		void pxPerSec;
		void containerWidth;
		const sc = scrollEl;
		if (!sc || zoom <= 1) return;
		const screenX = playheadLeftPx - sc.scrollLeft;
		const margin = 40;
		if (screenX < margin || screenX > sc.clientWidth - margin) {
			const target = Math.max(0, playheadLeftPx - sc.clientWidth / 2);
			scrollLeft = target;
			sc.scrollLeft = target;
		}
	});

	// Pick a "nice" tick interval so tick labels are readable regardless of zoom.
	const NICE_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
	const MINOR_TICKS_PER_MAJOR = 5;

	const tickInterval = $derived.by(() => {
		if (pxPerSec === 0) return 60;
		const targetPxBetweenTicks = 80;
		const rawSec = targetPxBetweenTicks / pxPerSec;
		return NICE_STEPS.find((s) => s >= rawSec) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
	});

	interface Tick {
		seconds: number;
		leftPx: number;
		major: boolean;
		label: string | null;
	}

	const ticks = $derived.by<Tick[]>(() => {
		const out: Tick[] = [];
		if (!duration || pxPerSec === 0) return out;
		const major = tickInterval;
		const minor = major / MINOR_TICKS_PER_MAJOR;
		const end = duration;
		// Step in minor increments, label only major boundaries.
		const epsilon = minor / 100;
		for (let s = 0; s <= end + epsilon; s += minor) {
			const isMajor = Math.abs(s % major) < epsilon || Math.abs((s % major) - major) < epsilon;
			out.push({
				seconds: s,
				leftPx: s * pxPerSec,
				major: isMajor,
				label: isMajor ? formatTimeLabel(s, major) : null
			});
		}
		return out;
	});

	function formatTimeLabel(seconds: number, step: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const totalMs = Math.round(seconds * 1000);
		const showFractions = step < 1;
		const h = Math.floor(totalMs / 3_600_000);
		const m = Math.floor((totalMs % 3_600_000) / 60_000);
		const s = Math.floor((totalMs % 60_000) / 1000);
		const ms = totalMs % 1000;
		const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
		const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
		if (showFractions) {
			const tenths = Math.round(ms / 100);
			return `${base}.${tenths}`;
		}
		return base;
	}

	function formatTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
		return formatTimeLabel(seconds, 1);
	}
</script>

<div class="select-none">
	<div class="mb-1.5 flex items-center gap-2">
		<span class="text-xs text-surface-500 tabular-nums">
			{formatTime(currentTime)} / {formatTime(duration)}
		</span>
		<span class="text-xs text-surface-500 tabular-nums">{(zoom * 100).toFixed(0)}%</span>
		<div class="flex-1"></div>
		<Button
			iconOnly
			size="sm"
			variant="tonal"
			color="surface"
			title="Keyboard shortcuts"
			aria-label="Keyboard shortcuts"
			data-icon={ICONS.keyboard}
			onclick={() => onopenShortcuts?.()}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.keyboard} class="size-4" />
			{/snippet}
		</Button>
		<Button size="sm" onclick={() => oncreateMoment?.()}>
			{#snippet icon()}
				<AppIcon name={ICONS.plus} class="size-4" />
			{/snippet}
			New moment
		</Button>
		<Button
			size="sm"
			variant={hasPending ? 'filled' : 'tonal'}
			color={hasPending ? 'warning' : 'surface'}
			loading={savingPending}
			disabled={!hasPending || savingPending}
			onclick={savePending}
		>
			{#snippet icon()}
				<AppIcon name={ICONS.save} class="size-4" />
			{/snippet}
			Save changes
		</Button>
	</div>

	<div bind:this={scrollEl} class="timeline-scroll overflow-x-scroll overflow-y-hidden">
		<div class="relative" style="width: {innerWidth}px;">
			<!-- Ruler (click to scrub) -->
			<button
				bind:this={rulerEl}
				type="button"
				class="relative block h-5 w-full cursor-pointer border-b border-surface-300-700 text-left hover:bg-surface-200-800"
				aria-label="Seek"
				onclick={onRulerClick}
			>
				{#each ticks as t (t.seconds)}
					<div
						class="pointer-events-none absolute top-0 bottom-0 {t.major
							? 'w-px bg-surface-400-600'
							: 'w-px bg-surface-300-700'}"
						style="left: {t.leftPx}px;"
					>
						{#if t.label}
							<span
								class="absolute top-0 left-1 text-[10px] whitespace-nowrap text-surface-500 tabular-nums"
							>
								{t.label}
							</span>
						{/if}
					</div>
				{/each}
				<!-- Ruler playhead indicator -->
				<div
					class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-blue-500"
					style="left: {playheadLeftPx}px;"
				></div>
			</button>

			<!-- Track + waveform — unified container -->
			<div class="overflow-hidden rounded-b-lg border border-surface-300-700 bg-surface-100-900">
				<div
					bind:this={trackEl}
					class="relative h-28 cursor-pointer"
					role="slider"
					tabindex="0"
					aria-label="Timeline"
					aria-valuemin={0}
					aria-valuemax={duration}
					aria-valuenow={currentTime}
					onclick={onTrackClick}
					onkeydown={() => {}}
				>
					<!-- Moment bars -->
					{#each moments as m (m.id)}
						{@const status = momentStatus(m)}
						<div
							class="group absolute top-1 bottom-1 cursor-grab rounded-md border transition-colors active:cursor-grabbing {isDirty(
								m.id
							)
								? 'border-warning-500 bg-warning-500/40 hover:bg-warning-500/55'
								: 'border-primary-500/60 bg-primary-500/35 hover:bg-primary-500/55'} {m.id ===
							selectedId
								? isDirty(m.id)
									? 'ring-2 ring-warning-500'
									: 'border-primary-500 ring-2 ring-primary-500'
								: ''}"
							style={momentStylePx(m)}
							title="{m.name || 'Untitled'} ({effective(m).startSeconds.toFixed(2)}s – {effective(
								m
							).endSeconds.toFixed(2)}s)"
							role="button"
							tabindex="0"
							onmousedown={(e) => beginDrag('move', m, e)}
							onclick={(e) => {
								e.stopPropagation();
								onselectMoment?.(m.id);
							}}
							onkeydown={() => {}}
						>
							<!-- Status pill -->
							{#if shouldShowStatusPill(m)}
								<div
									class="pointer-events-none absolute top-1 left-3 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/95"
								>
									{#if status.kind === 'processing'}
										{#if status.progress != null}
											<svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
												<circle
													cx="8"
													cy="8"
													r="6"
													fill="none"
													stroke="currentColor"
													stroke-opacity="0.25"
													stroke-width="2"
												/>
												<circle
													cx="8"
													cy="8"
													r="6"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-dasharray={progressDashArray(status.progress)}
													transform="rotate(-90 8 8)"
												/>
											</svg>
										{:else}
											<AppIcon name={ICONS.loading} class="size-3 animate-spin" />
										{/if}
									{:else if status.kind === 'processed'}
										<AppIcon name={ICONS.momentReady} class="size-3 text-success-400" />
									{:else if status.kind === 'failed'}
										<AppIcon name={ICONS.warning} class="size-3 text-error-400" />
									{:else}
										<AppIcon name={ICONS.loading} class="size-3 text-white/70" />
									{/if}
									<span>{status.label}</span>
								</div>
							{/if}

							<!-- Moment name -->
							<span
								class="pointer-events-none absolute inset-x-3 bottom-1 truncate text-[10px] font-medium text-white/90"
							>
								{m.name || 'Untitled'}
								{#if isDirty(m.id)}
									<span class="ml-1 text-warning-200">●</span>
								{/if}
							</span>

							<!-- Left handle -->
							<div
								class="absolute top-0 bottom-0 left-0 flex w-2 cursor-ew-resize items-center justify-center rounded-l-md {isDirty(
									m.id
								)
									? 'bg-warning-500/80 hover:bg-warning-500'
									: 'bg-primary-500/80 hover:bg-primary-500'}"
								role="button"
								tabindex="0"
								aria-label="Resize start"
								onmousedown={(e) => {
									e.stopPropagation();
									beginDrag('start', m, e);
								}}
								onclick={(e) => e.stopPropagation()}
								onkeydown={() => {}}
							>
								<AppIcon name={ICONS.ellipsis} class="size-3 text-white/90" />
							</div>

							<!-- Right handle -->
							<div
								class="absolute top-0 right-0 bottom-0 flex w-2 cursor-ew-resize items-center justify-center rounded-r-md {isDirty(
									m.id
								)
									? 'bg-warning-500/80 hover:bg-warning-500'
									: 'bg-primary-500/80 hover:bg-primary-500'}"
								role="button"
								tabindex="0"
								aria-label="Resize end"
								onmousedown={(e) => {
									e.stopPropagation();
									beginDrag('end', m, e);
								}}
								onclick={(e) => e.stopPropagation()}
								onkeydown={() => {}}
							>
								<AppIcon name={ICONS.ellipsis} class="size-3 text-white/90" />
							</div>
						</div>
					{/each}

					<!-- Playhead -->
					<div
						class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-blue-500 shadow-lg"
						style="left: {playheadLeftPx}px;"
					>
						<div class="absolute -top-1 -left-1 size-2 rounded-full bg-blue-500"></div>
					</div>
				</div>

				<!-- Waveform — viewport-pinned canvas (sticky), draws only the visible region -->
				{#if hasWaveform}
					<div
						bind:this={waveformRowEl}
						class="waveform-row relative cursor-pointer border-t border-surface-300-700 bg-surface-200-800/40"
						style="width: {containerWidth}px; height: {WAVEFORM_HEIGHT}px;"
						role="button"
						tabindex="0"
						aria-label="Seek waveform"
						onclick={onWaveformClick}
						onkeydown={() => {}}
					>
						<canvas
							bind:this={waveformCanvas}
							class="waveform-canvas block"
							style="width: {containerWidth}px; height: {WAVEFORM_HEIGHT}px;"
						></canvas>
						<!-- Waveform playhead -->
						<div
							class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-blue-500"
							style="left: {playheadLeftPx - scrollLeft}px;"
						></div>
					</div>
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

	.waveform-row {
		position: sticky;
		left: 0;
	}
</style>
