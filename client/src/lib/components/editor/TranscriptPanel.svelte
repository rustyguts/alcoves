<script lang="ts">
	/**
	 * TranscriptPanel — the Transcript inspector tab.
	 *
	 * Two views: "Cues" lists every VTT cue (searchable, click-to-seek, with the
	 * cue covering `currentTime` highlighted and auto-scrolled into view); "Top
	 * words" ranks the most-spoken words with stopwords filtered out — clicking
	 * a word jumps back to the Cues view pre-filtered to it.
	 *
	 * With no cues the tab renders an empty state that can launch the local
	 * transcription job (CPU-only, nothing leaves the instance).
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { ICONS } from '$lib/utils/icons';
	import { cn } from '$lib/utils';
	import type { VttCue } from '$lib/utils/parse-vtt';
	import type { JobStatusButton } from '$lib/utils/job-status-button';

	interface Props {
		cues: VttCue[];
		currentTime: number;
		onseek?: (seconds: number) => void;
		/** Transcribe job button state for the empty-state CTA. */
		jobButton?: JobStatusButton | null;
		onrunjob?: () => void;
	}

	let { cues, currentTime, onseek, jobButton = null, onrunjob }: Props = $props();

	let tab = $state<'cues' | 'top'>('cues');
	let search = $state('');
	let topCount = $state(10);
	const COUNT_OPTIONS = [5, 10, 20, 50, 100];

	// Common English stopwords + transcription filler. Lowercase, no punctuation.
	const STOPWORDS = new Set([
		'the',
		'a',
		'an',
		'and',
		'or',
		'but',
		'of',
		'to',
		'in',
		'on',
		'at',
		'for',
		'with',
		'by',
		'from',
		'up',
		'down',
		'out',
		'as',
		'if',
		'so',
		'than',
		'then',
		'is',
		'am',
		'are',
		'was',
		'were',
		'be',
		'been',
		'being',
		'do',
		'does',
		'did',
		'doing',
		'have',
		'has',
		'had',
		'having',
		'will',
		'would',
		'could',
		'should',
		'shall',
		'may',
		'might',
		'can',
		'must',
		'i',
		'you',
		'he',
		'she',
		'it',
		'we',
		'they',
		'me',
		'him',
		'her',
		'us',
		'them',
		'my',
		'your',
		'yours',
		'his',
		'its',
		'our',
		'ours',
		'their',
		'theirs',
		'myself',
		'yourself',
		'himself',
		'herself',
		'itself',
		'ourselves',
		'themselves',
		'this',
		'that',
		'these',
		'those',
		'what',
		'which',
		'who',
		'whom',
		'whose',
		'when',
		'where',
		'why',
		'how',
		'not',
		'no',
		'yes',
		'yeah',
		'yep',
		'nope',
		'ok',
		'okay',
		'um',
		'uh',
		'oh',
		'ah',
		'hmm',
		'mm',
		'er',
		'like',
		'just',
		'really',
		'very',
		'so',
		'such',
		'too',
		'also',
		'there',
		'here',
		'all',
		'any',
		'some',
		'most',
		'more',
		'less',
		'few',
		'many',
		'much',
		'lot',
		'lots',
		'every',
		'each',
		'other',
		'another',
		'same',
		'own',
		'about',
		'into',
		'onto',
		'over',
		'under',
		'after',
		'before',
		'between',
		'through',
		'during',
		'above',
		'below',
		'again',
		'further',
		'still',
		'ever',
		'never',
		'always',
		'sometimes',
		'often',
		'now',
		'soon',
		'later',
		'going',
		'gonna',
		'wanna',
		'gotta',
		'got',
		'get',
		'go'
	]);

	const filteredCues = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return cues;
		return cues.filter((c) => c.text.toLowerCase().includes(q));
	});

	const activeIndex = $derived.by(() => {
		const t = currentTime;
		const list = filteredCues;
		for (let i = 0; i < list.length; i++) {
			const c = list[i]!;
			if (t >= c.startSeconds && t <= c.endSeconds) return i;
		}
		return -1;
	});

	interface WordCount {
		word: string;
		count: number;
	}

	const topWords = $derived.by<WordCount[]>(() => {
		const counts = new Map<string, number>();
		for (const c of cues) {
			const tokens = c.text.toLowerCase().match(/\b[a-z][a-z']*\b/g);
			if (!tokens) continue;
			for (const raw of tokens) {
				const word = raw.replace(/^'+|'+$/g, '');
				if (word.length < 2) continue;
				if (STOPWORDS.has(word)) continue;
				counts.set(word, (counts.get(word) ?? 0) + 1);
			}
		}
		return [...counts.entries()]
			.map(([word, count]) => ({ word, count }))
			.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
			.slice(0, topCount);
	});

	const maxWordCount = $derived(topWords[0]?.count ?? 0);

	let listRef = $state<HTMLUListElement | null>(null);

	$effect(() => {
		const idx = activeIndex;
		const currentTab = tab;
		if (currentTab !== 'cues') return;
		if (idx < 0) return;
		const list = listRef;
		if (!list) return;
		const row = list.children[idx] as HTMLElement | undefined;
		row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});

	function formatTime(seconds: number): string {
		const s = Math.max(0, seconds);
		const m = Math.floor(s / 60);
		const rem = Math.floor(s % 60);
		return `${m}:${rem.toString().padStart(2, '0')}`;
	}

	function pickWord(word: string) {
		search = word;
		tab = 'cues';
	}
</script>

{#if cues.length === 0}
	<EmptyState
		icon={ICONS.transcript}
		title="No transcript yet"
		description={jobButton?.loading
			? 'Transcription is running on this instance — results appear here when it finishes.'
			: 'Transcribe this file locally to search speech, seek by sentence and power highlight filters. CPU-only — nothing leaves your instance.'}
	>
		{#snippet actions()}
			{#if onrunjob}
				<Button
					size="sm"
					variant="secondary"
					disabled={jobButton?.loading || jobButton?.disabled}
					aria-busy={jobButton?.loading || undefined}
					onclick={() => onrunjob?.()}
				>
					{#if jobButton?.loading}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.transcript} class="size-4" />
					{/if}
					{jobButton?.label ?? 'Transcribe'}
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else}
	<div class="flex flex-col gap-2" data-testid="transcript-panel">
		<div class="flex items-center gap-1">
			<button
				type="button"
				class={cn(
					'rounded-t-md border-b-2 px-2.5 py-1 text-xs font-medium transition-colors',
					tab === 'cues'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:text-foreground'
				)}
				onclick={() => (tab = 'cues')}
			>
				Cues
			</button>
			<button
				type="button"
				class={cn(
					'rounded-t-md border-b-2 px-2.5 py-1 text-xs font-medium transition-colors',
					tab === 'top'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:text-foreground'
				)}
				onclick={() => (tab = 'top')}
			>
				Top words
			</button>
			<span class="flex-1"></span>
			<Badge variant="secondary">{cues.length} cues</Badge>
		</div>

		{#if tab === 'cues'}
			<div class="flex flex-col gap-2">
				<div>
					<InputGroup.Root>
						<InputGroup.Addon>
							<AppIcon name={ICONS.search} class="size-3.5 text-muted-foreground" />
						</InputGroup.Addon>
						<InputGroup.Input
							bind:value={search}
							type="text"
							placeholder="Search transcript…"
							aria-label="Search transcript"
						/>
						<InputGroup.Addon align="inline-end" class="gap-1.5">
							<span class="text-[11px] text-muted-foreground tabular-nums">
								{filteredCues.length}/{cues.length}
							</span>
							{#if search}
								<InputGroup.Button
									size="icon-xs"
									aria-label="Clear search"
									onclick={() => (search = '')}
								>
									<AppIcon name={ICONS.close} class="size-3.5" />
								</InputGroup.Button>
							{/if}
						</InputGroup.Addon>
					</InputGroup.Root>
				</div>

				{#if filteredCues.length > 0}
					<ul bind:this={listRef} class="flex flex-col gap-0.5">
						{#each filteredCues as cue, idx (`${cue.startSeconds}-${idx}`)}
							<li
								class={cn(
									'rounded-lg transition-colors',
									idx === activeIndex ? 'bg-primary/10' : 'hover:bg-accent'
								)}
							>
								<button
									type="button"
									class="flex w-full items-start gap-3 px-3 py-2.5 text-left"
									onclick={() => onseek?.(cue.startSeconds)}
								>
									<span
										class={cn(
											'mt-0.5 flex shrink-0 items-center gap-1 text-[11px] tabular-nums',
											idx === activeIndex ? 'font-semibold text-primary' : 'text-muted-foreground'
										)}
									>
										{#if idx === activeIndex}
											<AppIcon name={ICONS.play} class="size-2.5" />
										{/if}
										{formatTime(cue.startSeconds)}
									</span>
									<span class="text-sm leading-snug">
										{cue.text}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="px-3 py-4 text-center text-xs text-muted-foreground">
						No matches for "{search}".
					</p>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between gap-2">
					<p class="text-[11px] text-muted-foreground">
						Most-spoken words (stopwords excluded). Click to filter cues.
					</p>
					<label class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<span>Top</span>
						<Select.Root
							type="single"
							value={String(topCount)}
							onValueChange={(v) => v && (topCount = Number(v))}
						>
							<Select.Trigger
								size="sm"
								class="h-7 px-1.5 text-xs tabular-nums"
								aria-label="Top word count"
							>
								{topCount}
							</Select.Trigger>
							<Select.Content>
								{#each COUNT_OPTIONS as n (n)}
									<Select.Item value={String(n)} label={String(n)} />
								{/each}
							</Select.Content>
						</Select.Root>
					</label>
				</div>

				{#if topWords.length > 0}
					<ul class="flex flex-col gap-0.5">
						{#each topWords as w, idx (w.word)}
							<li class="rounded-lg transition-colors hover:bg-accent">
								<button
									type="button"
									class="flex w-full items-center gap-3 px-3 py-2.5 text-left"
									onclick={() => pickWord(w.word)}
								>
									<span class="w-6 shrink-0 text-[11px] text-muted-foreground tabular-nums">
										{idx + 1}.
									</span>
									<span class="flex-1 truncate text-sm font-medium">{w.word}</span>
									<div class="flex w-32 shrink-0 items-center gap-2">
										<div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
											<div
												class="absolute inset-y-0 left-0 rounded-full bg-primary"
												style="width: {maxWordCount > 0 ? (w.count / maxWordCount) * 100 : 0}%;"
											></div>
										</div>
										<span class="w-8 text-right text-[11px] text-muted-foreground tabular-nums">
											{w.count}
										</span>
									</div>
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="px-3 py-4 text-center text-xs text-muted-foreground">No words to count.</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}
