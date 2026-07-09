<script lang="ts">
	import { tick } from 'svelte';
	import { ICONS } from '$lib/utils/icons';
	import { formatFileSize } from '$lib/utils/mime-icons';
	import { uploadQueue } from '$lib/state/upload-queue.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';

	/**
	 * App-wide upload progress panel. Mounted once in the authed layout so it stays
	 * pinned to the bottom-right and keeps reporting while the user navigates the
	 * SPA — it remains fully visible until the queue drains to empty.
	 *
	 * The per-file list is **virtualized**: with thousands of queued files only the
	 * handful of rows in the viewport (plus a small overscan) are in the DOM, so the
	 * panel stays smooth regardless of queue size. Every row is a fixed height
	 * (`ROW_H`) so the windowing math is exact.
	 */

	/** Fixed row height in px — MUST match each row's rendered height (`h-14`). */
	const ROW_H = 56;
	/** Extra rows rendered above/below the viewport to avoid blank flashes on scroll. */
	const OVERSCAN = 6;
	/** Max viewport height of the scroll area in px (capped to 50dvh on short screens). */
	const VIEWPORT_H = 320;

	let expanded = $state(true);
	let filter = $state<'all' | 'failed'>('all');
	let scrollTop = $state(0);
	let viewportH = $state(VIEWPORT_H);
	let toggleBtn = $state<HTMLButtonElement>();

	// When the error filter is active the source is the (small) errored subset,
	// otherwise it's the full queue exposed as-is (no copy on the hot path).
	const displayItems = $derived(
		filter === 'failed' ? uploadQueue.queue.filter((f) => f.status === 'error') : uploadQueue.queue
	);

	const total = $derived(displayItems.length);
	const visibleCount = $derived(Math.ceil(viewportH / ROW_H) + OVERSCAN * 2);
	// Clamp the window start so it can never render an empty slice past the end when
	// the list shrinks under the user (sweep/cancel) or the filter narrows it.
	const maxStart = $derived(Math.max(0, total - visibleCount));
	const startIndex = $derived(
		Math.min(maxStart, Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN))
	);
	const endIndex = $derived(Math.min(total, startIndex + visibleCount));
	const windowItems = $derived(displayItems.slice(startIndex, endIndex));
	const topPad = $derived(startIndex * ROW_H);
	const bottomPad = $derived(Math.max(0, (total - endIndex) * ROW_H));

	const overallPercent = $derived(uploadQueue.overallProgress);

	const headerTitle = $derived(
		uploadQueue.hasInFlightUploads
			? 'Uploading'
			: uploadQueue.errorCount > 0
				? 'Finished with errors'
				: 'Upload complete'
	);

	function onScroll(event: Event) {
		scrollTop = (event.currentTarget as HTMLElement).scrollTop;
	}

	function toggleExpanded() {
		expanded = !expanded;
		// The scroll container remounts on expand; reset so the windowing state matches.
		scrollTop = 0;
	}

	function setFilter(next: 'all' | 'failed') {
		filter = next;
		scrollTop = 0;
	}

	// Run a queue action, then return focus to the always-present header toggle so it
	// doesn't fall to <body> when the activated control (a row button) unmounts.
	async function act(fn: () => void) {
		fn();
		await tick();
		toggleBtn?.focus();
	}

	// Warn before the page is unloaded while uploads are still in flight — a reload
	// or close would abort them. Returning a string triggers the browser's native
	// confirmation dialog.
	function onBeforeUnload(event: BeforeUnloadEvent) {
		if (!uploadQueue.hasInFlightUploads) return;
		event.preventDefault();
		event.returnValue = '';
		return '';
	}
</script>

<svelte:window onbeforeunload={onBeforeUnload} />

{#if uploadQueue.hasActiveUploads}
	<div
		class="fixed right-4 bottom-4 z-50 w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-card shadow-xs sm:w-96"
		role="region"
		aria-label="Upload progress"
	>
		<!-- Header / collapse toggle -->
		<button
			type="button"
			bind:this={toggleBtn}
			class="flex w-full items-center justify-between gap-2 bg-muted px-4 py-2.5 text-left select-none"
			onclick={toggleExpanded}
			aria-expanded={expanded}
		>
			<span class="flex min-w-0 flex-col">
				<span class="truncate text-sm font-medium">{headerTitle}</span>
				<span class="text-xs text-muted-foreground">
					{uploadQueue.completedCount} of {uploadQueue.submittedCount}
					{#if uploadQueue.errorCount > 0}
						· <span class="text-destructive">{uploadQueue.errorCount} failed</span>
					{/if}
				</span>
			</span>
			<span class="flex shrink-0 items-center gap-2">
				{#if uploadQueue.uploadSpeed > 0}
					<span class="text-xs text-muted-foreground"
						>{formatFileSize(uploadQueue.uploadSpeed)}/s</span
					>
				{/if}
				<AppIcon
					name={expanded ? ICONS.chevronDown : ICONS.chevronUp}
					class="size-4 text-muted-foreground"
				/>
			</span>
		</button>

		<!-- Overall progress (by completed file count) -->
		<Progress value={overallPercent} class="h-1 rounded-none" />

		{#if expanded}
			{#if uploadQueue.hasInFlightUploads || uploadQueue.errorCount > 0}
				<div class="flex items-center justify-between gap-2 px-4 py-1.5">
					<div class="flex gap-1">
						{#if uploadQueue.errorCount > 0}
							<Button
								variant={filter === 'all' ? 'secondary' : 'ghost'}
								size="sm"
								onclick={() => setFilter('all')}
							>
								All
							</Button>
							<Button
								variant={filter === 'failed' ? 'destructive' : 'ghost'}
								size="sm"
								class={filter === 'failed' ? '' : 'text-destructive hover:bg-destructive/10'}
								onclick={() => setFilter('failed')}
							>
								{uploadQueue.errorCount} failed
							</Button>
						{/if}
					</div>
					<div class="flex gap-1">
						{#if uploadQueue.hasInFlightUploads}
							<Button variant="ghost" size="sm" onclick={() => act(() => uploadQueue.cancelAll())}>
								Cancel all
							</Button>
						{/if}
						{#if uploadQueue.errorCount > 0}
							<Button variant="ghost" size="sm" onclick={() => act(() => uploadQueue.retryAll())}>
								Retry all
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="text-destructive hover:bg-destructive/10"
								onclick={() => act(() => uploadQueue.clearErrors())}
							>
								Clear
							</Button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Virtualized scroll area -->
			<div
				class="overflow-y-auto"
				style:max-height="min({VIEWPORT_H}px, 50dvh)"
				onscroll={onScroll}
				bind:clientHeight={viewportH}
			>
				<div style:height="{topPad}px"></div>
				{#each windowItems as item (item.id)}
					<div class="flex h-14 items-center gap-2 px-3 hover:bg-muted" data-upload-row>
						<div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
							<div class="flex items-center justify-between gap-2">
								<span class="min-w-0 flex-1 truncate text-sm" title={item.file.name}
									>{item.file.name}</span
								>
								<span class="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
									>{item.libraryName}</span
								>
							</div>

							{#if item.status === 'uploading'}
								<div class="flex items-center gap-2">
									<Progress value={item.progress} class="h-1.5 flex-1" />
									<span class="w-9 text-right text-xs text-muted-foreground">{item.progress}%</span>
								</div>
							{:else if item.status === 'error'}
								<span class="flex items-center gap-1 text-xs text-destructive">
									<AppIcon name={ICONS.warning} class="size-3.5 shrink-0" />
									<span class="truncate" title={item.error}>{item.error ?? 'Upload failed'}</span>
								</span>
							{:else if item.status === 'done'}
								<span class="flex items-center gap-1 text-xs text-success">
									<AppIcon name={ICONS.check} class="size-3.5 shrink-0" />
									{#if item.duplicateCount && item.duplicateCount > 0}
										Done · duplicate
									{:else}
										Done
									{/if}
								</span>
							{:else}
								<span class="text-xs text-muted-foreground">Queued</span>
							{/if}
						</div>

						<!-- Per-row actions -->
						<div class="flex shrink-0 items-center gap-1">
							{#if item.status === 'error'}
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Retry upload"
									title="Retry"
									onclick={() => act(() => uploadQueue.retryFile(item.id))}
								>
									<AppIcon name={ICONS.retry} class="size-3.5" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									class="text-destructive hover:bg-destructive/10"
									aria-label="Remove upload"
									title="Remove"
									onclick={() => act(() => uploadQueue.removeFile(item.id))}
								>
									<AppIcon name={ICONS.trash} class="size-3.5" />
								</Button>
							{:else if item.status === 'pending' || item.status === 'uploading'}
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Cancel upload"
									title="Cancel"
									onclick={() => act(() => uploadQueue.cancelFile(item.id))}
								>
									<AppIcon name={ICONS.close} class="size-3.5" />
								</Button>
							{/if}
						</div>
					</div>
				{/each}
				<div style:height="{bottomPad}px"></div>
			</div>
		{/if}
	</div>
{/if}
