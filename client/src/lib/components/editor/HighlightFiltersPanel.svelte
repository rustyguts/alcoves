<script lang="ts">
	/**
	 * HighlightFiltersPanel — the Highlights inspector tab.
	 *
	 * Lists every filter (sorted by hit count, then name), shows its aggregate
	 * stats, and lets the user add/edit/remove filters or load the preset pack.
	 * Expanding a filter reveals its individual matches; clicking a match fires
	 * `onseek`. Matches also render as colored markers on the timeline's
	 * markers lane — same data, two surfaces.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type {
		HighlightFilter,
		HighlightFilterCreate,
		HighlightFilterPatch
	} from '$lib/types/api';
	import type { FilterAggregate, FilterMatch } from '$lib/state/editor-highlights.svelte';

	interface Props {
		filters: HighlightFilter[];
		matches: Record<string, FilterMatch[]>;
		aggregates: Record<string, FilterAggregate>;
		loading?: boolean;
		hasSignals: boolean;
		onseek?: (seconds: number) => void;
		oncreate?: (body: HighlightFilterCreate) => void;
		onupdate?: (id: string, body: HighlightFilterPatch) => void;
		onremove?: (id: string) => void;
		onloadpresets?: () => void;
	}

	let {
		filters,
		matches,
		aggregates,
		loading = false,
		hasSignals,
		onseek,
		oncreate,
		onupdate,
		onremove,
		onloadpresets
	}: Props = $props();

	interface DraftState {
		name: string;
		expression: string;
		proximitySeconds: number;
		color: string;
	}

	function blankDraft(): DraftState {
		return { name: '', expression: '', proximitySeconds: 5, color: '#3B82F6' };
	}

	// Holds embedded double quotes — kept in script so Prettier doesn't mangle
	// the attribute quoting.
	const EXPRESSION_PLACEHOLDER = 'laughter:25, screaming & word:wtf, "machine gun":40';

	let expanded = $state<Set<string>>(new Set());
	let editing = $state<string | null>(null);
	let adding = $state(false);
	let draft = $state<DraftState>(blankDraft());

	function startAdd() {
		draft = blankDraft();
		adding = true;
		editing = null;
	}

	function cancelAdd() {
		adding = false;
		draft = blankDraft();
	}

	function submitAdd() {
		if (!draft.name.trim() || !draft.expression.trim()) return;
		oncreate?.({
			name: draft.name.trim(),
			expression: draft.expression.trim(),
			proximitySeconds: draft.proximitySeconds,
			color: draft.color
		});
		cancelAdd();
	}

	function startEdit(f: HighlightFilter) {
		editing = f.id;
		draft = {
			name: f.name,
			expression: f.expression,
			proximitySeconds: f.proximitySeconds,
			color: f.color
		};
		adding = false;
	}

	function cancelEdit() {
		editing = null;
	}

	function submitEdit(id: string) {
		if (!draft.name.trim() || !draft.expression.trim()) return;
		onupdate?.(id, {
			name: draft.name.trim(),
			expression: draft.expression.trim(),
			proximitySeconds: draft.proximitySeconds,
			color: draft.color
		});
		editing = null;
	}

	function toggleExpand(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	function formatTime(seconds: number): string {
		const s = Math.max(0, Math.floor(seconds));
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return `${m}:${rem.toString().padStart(2, '0')}`;
	}

	function joinEvidence(ev: string[]): string {
		return ev.map((s) => `"${s}"`).join(' + ');
	}

	const sortedFilters = $derived(
		[...filters].sort((a, b) => {
			const aCount = aggregates[a.id]?.count ?? 0;
			const bCount = aggregates[b.id]?.count ?? 0;
			if (aCount !== bCount) return bCount - aCount;
			return a.name.localeCompare(b.name);
		})
	);
</script>

<div class="flex flex-col" data-testid="highlight-filters-panel">
	<div class="flex items-center justify-between gap-2 border-b border-surface-200-800 pb-2">
		<div class="flex min-w-0 items-center gap-2">
			<span class="badge preset-tonal-surface text-xs">{filters.length}</span>
			<span title="Comma = OR · & = AND · word:foo = transcript · audio:foo = label · :25 = min %">
				<AppIcon name={ICONS.help} class="size-3.5 text-surface-600-400" />
			</span>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			{#if filters.length === 0}
				<Button
					variant="tonal"
					color="primary"
					size="sm"
					{loading}
					onclick={() => onloadpresets?.()}
				>
					{#snippet icon()}
						<AppIcon name={ICONS.loadPresets} class="size-4" />
					{/snippet}
					Load presets
				</Button>
			{/if}
			<Button size="sm" onclick={startAdd}>
				{#snippet icon()}
					<AppIcon name={ICONS.plus} class="size-4" />
				{/snippet}
				Add filter
			</Button>
		</div>
	</div>

	{#if !hasSignals && filters.length === 0 && !adding}
		<p class="px-1 py-2 text-[11px] text-surface-600-400">
			Run <span class="font-medium">Transcribe</span> or
			<span class="font-medium">Waveform → Detect audio</span>
			first to give filters something to match.
		</p>
	{/if}

	<!-- Add form -->
	{#if adding}
		<div class="border-b border-surface-200-800 bg-surface-200-800/50 px-2 py-2">
			<div class="flex flex-wrap items-end gap-2">
				<div class="flex w-40 flex-col gap-1">
					<label class="text-[11px] font-medium text-surface-600-400" for="hf-add-name">Name</label>
					<input id="hf-add-name" class="input" bind:value={draft.name} placeholder="Funny clip" />
				</div>
				<div class="flex min-w-[200px] flex-1 flex-col gap-1">
					<label class="text-[11px] font-medium text-surface-600-400" for="hf-add-expr">
						Expression <span class="text-surface-500">(comma = OR, & = AND)</span>
					</label>
					<input
						id="hf-add-expr"
						class="input"
						bind:value={draft.expression}
						placeholder={EXPRESSION_PLACEHOLDER}
					/>
				</div>
				<div class="flex w-24 flex-col gap-1">
					<label class="text-[11px] font-medium text-surface-600-400" for="hf-add-prox">
						AND ± {draft.proximitySeconds}s
					</label>
					<input
						id="hf-add-prox"
						class="input"
						type="range"
						min="0"
						max="30"
						step="1"
						bind:value={draft.proximitySeconds}
					/>
				</div>
				<div class="flex w-12 flex-col gap-1">
					<label class="text-[11px] font-medium text-surface-600-400" for="hf-add-color"
						>Color</label
					>
					<input
						id="hf-add-color"
						type="color"
						class="h-7 w-10 cursor-pointer rounded border border-surface-200-800"
						bind:value={draft.color}
					/>
				</div>
				<div class="flex items-center gap-1">
					<Button variant="tonal" color="surface" size="sm" onclick={cancelAdd}>Cancel</Button>
					<Button size="sm" onclick={submitAdd}>
						{#snippet icon()}
							<AppIcon name={ICONS.check} class="size-4" />
						{/snippet}
						Save
					</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if sortedFilters.length > 0}
		<ul class="flex flex-col divide-y divide-surface-200-800">
			{#each sortedFilters as f (f.id)}
				<li class="py-2">
					{#if editing === f.id}
						<!-- Edit form -->
						<div class="flex flex-wrap items-end gap-2">
							<div class="flex w-40 flex-col gap-1">
								<label class="text-[11px] font-medium text-surface-600-400" for="hf-edit-name">
									Name
								</label>
								<input id="hf-edit-name" class="input" bind:value={draft.name} />
							</div>
							<div class="flex min-w-[200px] flex-1 flex-col gap-1">
								<label class="text-[11px] font-medium text-surface-600-400" for="hf-edit-expr">
									Expression
								</label>
								<input id="hf-edit-expr" class="input" bind:value={draft.expression} />
							</div>
							<div class="flex w-24 flex-col gap-1">
								<label class="text-[11px] font-medium text-surface-600-400" for="hf-edit-prox">
									AND ± {draft.proximitySeconds}s
								</label>
								<input
									id="hf-edit-prox"
									class="input"
									type="range"
									min="0"
									max="30"
									step="1"
									bind:value={draft.proximitySeconds}
								/>
							</div>
							<div class="flex w-12 flex-col gap-1">
								<label class="text-[11px] font-medium text-surface-600-400" for="hf-edit-color">
									Color
								</label>
								<input
									id="hf-edit-color"
									type="color"
									class="h-7 w-10 cursor-pointer rounded border border-surface-200-800"
									bind:value={draft.color}
								/>
							</div>
							<div class="flex items-center gap-1">
								<Button variant="tonal" color="surface" size="sm" onclick={cancelEdit}>
									Cancel
								</Button>
								<Button size="sm" onclick={() => submitEdit(f.id)}>
									{#snippet icon()}
										<AppIcon name={ICONS.check} class="size-4" />
									{/snippet}
									Save
								</Button>
							</div>
						</div>
					{:else}
						<!-- Row -->
						<div class="flex min-w-0 items-center gap-2">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-2 text-left"
								onclick={() => toggleExpand(f.id)}
							>
								<AppIcon
									name={expanded.has(f.id) ? ICONS.chevronDown : ICONS.chevronRight}
									class="size-3.5 shrink-0 text-surface-600-400"
								/>
								<span class="size-2.5 shrink-0 rounded-full" style="background-color: {f.color};"
								></span>
								<span class="truncate text-sm font-medium">{f.name}</span>
								{#if (aggregates[f.id]?.expressionErrors?.length ?? 0) > 0}
									<span
										class="badge shrink-0 preset-tonal-warning text-xs"
										title={aggregates[f.id]?.expressionErrors.join('; ')}
									>
										parse error
									</span>
								{/if}
							</button>

							<div class="flex shrink-0 items-center gap-1.5">
								<span
									class="badge text-xs {(aggregates[f.id]?.count ?? 0) > 0
										? 'preset-tonal-primary'
										: 'preset-tonal-surface'}"
								>
									{aggregates[f.id]?.count ?? 0} hits
								</span>
								<Button
									iconOnly
									size="sm"
									variant="tonal"
									color="surface"
									aria-label="Edit filter"
									onclick={() => startEdit(f)}
								>
									{#snippet icon()}
										<AppIcon name={ICONS.edit} class="size-4" />
									{/snippet}
								</Button>
								<Button
									iconOnly
									size="sm"
									variant="tonal"
									color="error"
									aria-label="Remove filter"
									onclick={() => onremove?.(f.id)}
								>
									{#snippet icon()}
										<AppIcon name={ICONS.trash} class="size-4" />
									{/snippet}
								</Button>
							</div>
						</div>

						<!-- Expression + stats line -->
						<div class="mt-1 flex min-w-0 items-center gap-2 pl-5">
							<code class="truncate font-mono text-[11px] text-surface-500">{f.expression}</code>
							{#if (aggregates[f.id]?.count ?? 0) > 0}
								<span class="shrink-0 text-[10px] text-surface-600-400 tabular-nums">
									avg {((aggregates[f.id]?.meanScore ?? 0) * 100).toFixed(0)}% · max
									{((aggregates[f.id]?.maxScore ?? 0) * 100).toFixed(0)}%
								</span>
							{/if}
						</div>

						<!-- Expanded match list -->
						{#if expanded.has(f.id) && (matches[f.id]?.length ?? 0) > 0}
							<ul class="mt-2 flex flex-wrap gap-1 pl-5">
								{#each matches[f.id] as m, i (i)}
									<li>
										<button
											type="button"
											class="flex items-center gap-1 rounded-md border border-surface-200-800 px-2 py-0.5 text-[11px] tabular-nums hover:border-primary-500 hover:bg-surface-200-800"
											title={joinEvidence(m.evidence)}
											onclick={() => onseek?.(m.startSeconds)}
										>
											<AppIcon name={ICONS.play} class="size-2.5" />
											{formatTime(m.startSeconds)}
											<span class="text-surface-600-400">
												· {(m.score * 100).toFixed(0)}%
											</span>
											<span class="max-w-[220px] truncate text-surface-500">
												{joinEvidence(m.evidence)}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{:else if !adding}
		<div class="px-3 py-4 text-center text-xs text-surface-600-400">
			No filters yet. Click <span class="font-medium">Add filter</span> or
			<span class="font-medium">Load presets</span> to get started.
		</div>
	{/if}
</div>
