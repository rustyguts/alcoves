<script lang="ts">
	/**
	 * MomentsTrack — the draggable moment bars.
	 *
	 * Bars render at their EFFECTIVE range (pending drag edits override server
	 * values — the batch-save model lives in the Timeline container, this track
	 * only reads `pending` and emits `onpendingchange`). Drags are pointer-event
	 * based with pointer capture and `touch-action: none`, so they work with
	 * mouse, pen and touch:
	 *   - bar body  → move (both edges shift, length preserved)
	 *   - w-2 edge handles (with wider invisible hit zones) → resize start/end
	 *   - snapping (when enabled) pulls dragged edges onto other moments' edges
	 *     and the playhead, within min(8px, 1s)
	 * A sub-3px drag is treated as a click (select). After a real drag a
	 * one-shot capture-phase click listener swallows the click so the track
	 * doesn't seek, and the bar blurs so Space keeps toggling playback.
	 *
	 * Keyboard: bars are focusable buttons. Enter/Space selects; ArrowLeft/
	 * ArrowRight nudges the bar ±1 frame (Shift = ±1s) as a pending edit. The
	 * handler preventDefault+stopPropagation's those keys so the global
	 * shortcut map never double-fires.
	 */
	import { onDestroy } from 'svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { Moment } from '$lib/types/api';
	import {
		applySnap,
		clampDrag,
		snapCandidates,
		snapThreshold,
		type DragMode,
		type TimeRange
	} from '$lib/utils/timeline-geometry';
	import { FRAME_SECONDS } from '$lib/state/playback.svelte';

	interface Props {
		moments: Moment[];
		selectedId?: string | null;
		duration: number;
		pxPerSec: number;
		currentTime: number;
		pending: Record<string, TimeRange>;
		snapping?: boolean;
		playheadLeftPx: number;
		onpendingchange?: (momentId: string, range: TimeRange) => void;
		onselect?: (momentId: string) => void;
		onseek?: (seconds: number) => void;
		ondragactive?: (active: boolean) => void;
	}

	let {
		moments,
		selectedId = null,
		duration,
		pxPerSec,
		currentTime,
		pending,
		snapping = false,
		playheadLeftPx,
		onpendingchange,
		onselect,
		onseek,
		ondragactive
	}: Props = $props();

	let trackEl = $state<HTMLElement | null>(null);

	function effective(m: Moment): TimeRange {
		return pending[m.id] ?? { startSeconds: m.startSeconds, endSeconds: m.endSeconds };
	}

	function isDirty(id: string): boolean {
		return id in pending;
	}

	function momentStylePx(m: Moment): string {
		const eff = effective(m);
		const left = eff.startSeconds * pxPerSec;
		const width = Math.max(2, (eff.endSeconds - eff.startSeconds) * pxPerSec);
		return `left: ${left}px; width: ${width}px;`;
	}

	// — export status pill —

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

	// — pointer drags —

	interface DragState {
		mode: DragMode;
		momentId: string;
		startClientX: number;
		initial: TimeRange;
		moved: boolean;
		element: HTMLElement;
	}
	let drag: DragState | null = null;

	function snapRange(mode: DragMode, momentId: string, range: TimeRange): TimeRange {
		if (!snapping) return range;
		const threshold = snapThreshold(pxPerSec);
		if (threshold <= 0) return range;
		const candidates = snapCandidates(
			moments.map((m) => ({ id: m.id, ...effective(m) })),
			momentId,
			currentTime
		);
		if (mode === 'start') {
			const snapped = applySnap(range.startSeconds, candidates, threshold);
			const start = Math.min(snapped, range.endSeconds - 0.05);
			return { startSeconds: Math.max(0, start), endSeconds: range.endSeconds };
		}
		if (mode === 'end') {
			const snapped = applySnap(range.endSeconds, candidates, threshold);
			const end = Math.max(snapped, range.startSeconds + 0.05);
			return { startSeconds: range.startSeconds, endSeconds: Math.min(duration, end) };
		}
		// move: prefer snapping the leading edge, fall back to the trailing one,
		// preserving length and staying inside [0, duration].
		const len = range.endSeconds - range.startSeconds;
		const snappedStart = applySnap(range.startSeconds, candidates, threshold);
		if (snappedStart !== range.startSeconds) {
			const start = Math.max(0, Math.min(duration - len, snappedStart));
			return { startSeconds: start, endSeconds: start + len };
		}
		const snappedEnd = applySnap(range.endSeconds, candidates, threshold);
		if (snappedEnd !== range.endSeconds) {
			const end = Math.max(len, Math.min(duration, snappedEnd));
			return { startSeconds: end - len, endSeconds: end };
		}
		return range;
	}

	function beginDrag(mode: DragMode, m: Moment, event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		onselect?.(m.id);
		const element = event.currentTarget as HTMLElement;
		drag = {
			mode,
			momentId: m.id,
			startClientX: event.clientX,
			initial: effective(m),
			moved: false,
			element
		};
		element.setPointerCapture?.(event.pointerId);
		ondragactive?.(true);
	}

	function onDragMove(event: PointerEvent) {
		if (!drag || pxPerSec <= 0) return;
		const dxPx = event.clientX - drag.startClientX;
		if (Math.abs(dxPx) > 2) drag.moved = true;
		if (!drag.moved) return;
		const dxSec = dxPx / pxPerSec;
		const clamped = clampDrag(drag.mode, drag.initial, dxSec, duration);
		onpendingchange?.(drag.momentId, snapRange(drag.mode, drag.momentId, clamped));
	}

	// One-shot capture-phase click suppressor armed after a real mouse drag —
	// browsers synthesize a click right after pointerup which would otherwise
	// seek the track. Touch drags and pointercancel never produce that click,
	// so arming there would leave it primed to eat the user's NEXT genuine
	// click anywhere on the page; the pointerdown fallback and destroy hook
	// disarm it if the expected click never arrives.
	let disarmSuppressor: (() => void) | null = null;

	function armClickSuppressor() {
		const suppress = (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
			disarm();
		};
		const disarm = () => {
			window.removeEventListener('click', suppress, true);
			window.removeEventListener('pointerdown', disarm, true);
			disarmSuppressor = null;
		};
		disarmSuppressor = disarm;
		window.addEventListener('click', suppress, true);
		window.addEventListener('pointerdown', disarm, true);
	}

	onDestroy(() => {
		disarmSuppressor?.();
	});

	function onDragEnd(event: PointerEvent) {
		if (!drag) return;
		if (drag.moved && event.type === 'pointerup' && event.pointerType === 'mouse') {
			armClickSuppressor();
		}
		drag.element.releasePointerCapture?.(event.pointerId);
		// Blur the bar so Space keeps toggling playback after pointer drags.
		(drag.element.closest('[data-timeline-bar]') as HTMLElement | null)?.blur();
		drag = null;
		ondragactive?.(false);
	}

	// — keyboard nudging on a focused bar —

	function onBarKeydown(m: Moment, e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			onselect?.(m.id);
			return;
		}
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			e.stopPropagation();
			onselect?.(m.id);
			const direction = e.key === 'ArrowLeft' ? -1 : 1;
			const delta = direction * (e.shiftKey ? 1 : FRAME_SECONDS);
			onpendingchange?.(m.id, clampDrag('move', effective(m), delta, duration));
		}
	}

	function onTrackClick(event: MouseEvent) {
		const el = trackEl;
		if (!el || !duration || pxPerSec <= 0) return;
		const rect = el.getBoundingClientRect();
		const x = event.clientX - rect.left;
		onseek?.(Math.max(0, Math.min(duration, x / pxPerSec)));
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
	bind:this={trackEl}
	class="relative h-24 cursor-pointer"
	data-testid="moments-track"
	onclick={onTrackClick}
>
	{#each moments as m (m.id)}
		{@const status = momentStatus(m)}
		<div
			class="group absolute top-1 bottom-1 cursor-grab touch-none rounded-md border transition-colors active:cursor-grabbing {isDirty(
				m.id
			)
				? 'border-warning-500 bg-warning-500/40 hover:bg-warning-500/55'
				: 'border-primary-500/60 bg-primary-500/35 hover:bg-primary-500/55'} {m.id === selectedId
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
			data-timeline-bar={m.id}
			aria-label="Moment {m.name || 'Untitled'}"
			onpointerdown={(e) => beginDrag('move', m, e)}
			onpointermove={onDragMove}
			onpointerup={onDragEnd}
			onpointercancel={onDragEnd}
			onclick={(e) => {
				e.stopPropagation();
				onselect?.(m.id);
			}}
			onkeydown={(e) => onBarKeydown(m, e)}
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

			<!-- Moment name — scrim chip so it stays readable on the translucent
			     bar fill in BOTH themes (bare white text washes out in light mode) -->
			<span
				class="pointer-events-none absolute bottom-1 left-3 max-w-[calc(100%-1.5rem)] truncate rounded bg-black/55 px-1 text-[10px] font-medium text-white/95"
			>
				{m.name || 'Untitled'}
				{#if isDirty(m.id)}
					<span class="ml-1 text-warning-200">●</span>
				{/if}
			</span>

			<!-- Left handle (wider invisible hit zone for touch). Pointer-only and
			     aria-hidden: keyboard users resize via the bar's arrow-key nudge or
			     the edit form's number inputs, so announcing a non-operable
			     "button" would be fake semantics. -->
			<div
				class="absolute top-0 bottom-0 left-0 flex w-2 cursor-ew-resize touch-none items-center justify-center rounded-l-md before:absolute before:-inset-x-2 before:inset-y-0 before:content-[''] {isDirty(
					m.id
				)
					? 'bg-warning-500/80 hover:bg-warning-500'
					: 'bg-primary-500/80 hover:bg-primary-500'}"
				aria-hidden="true"
				data-resize-handle="start"
				onpointerdown={(e) => {
					e.stopPropagation();
					beginDrag('start', m, e);
				}}
				onpointermove={onDragMove}
				onpointerup={onDragEnd}
				onpointercancel={onDragEnd}
				onclick={(e) => e.stopPropagation()}
			>
				<AppIcon name={ICONS.ellipsis} class="size-3 text-white/90" />
			</div>

			<!-- Right handle -->
			<div
				class="absolute top-0 right-0 bottom-0 flex w-2 cursor-ew-resize touch-none items-center justify-center rounded-r-md before:absolute before:-inset-x-2 before:inset-y-0 before:content-[''] {isDirty(
					m.id
				)
					? 'bg-warning-500/80 hover:bg-warning-500'
					: 'bg-primary-500/80 hover:bg-primary-500'}"
				aria-hidden="true"
				data-resize-handle="end"
				onpointerdown={(e) => {
					e.stopPropagation();
					beginDrag('end', m, e);
				}}
				onpointermove={onDragMove}
				onpointerup={onDragEnd}
				onpointercancel={onDragEnd}
				onclick={(e) => e.stopPropagation()}
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
