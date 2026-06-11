<script lang="ts">
	/**
	 * TranscriptPanel — collapsible transcript display with search + word stats.
	 *
	 * Two tabs: "Cues" lists every VTT cue (searchable, click-to-seek, with the
	 * cue covering `currentTime` highlighted and auto-scrolled into view); "Top
	 * words" ranks the most-spoken words with stopwords filtered out — clicking a
	 * word jumps back to the Cues tab pre-filtered to it.
	 */
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { VttCue } from '$lib/utils/parse-vtt';

	interface Props {
		cues: VttCue[];
		currentTime: number;
		onseek?: (seconds: number) => void;
	}

	let { cues, currentTime, onseek }: Props = $props();

	let collapsed = $state(false);
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
		'go',
		'going'
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
		if (collapsed) return;
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

{#if cues.length > 0}
	<div class="rounded-md bg-surface-200-800/50">
		<button
			type="button"
			class="flex w-full items-center justify-between gap-2 border-b border-surface-200-800 px-3 py-2 text-left transition-colors hover:bg-surface-200-800/40"
			class:border-b-0={collapsed}
			onclick={() => (collapsed = !collapsed)}
		>
			<div class="flex items-center gap-2">
				<AppIcon
					name={collapsed ? ICONS.chevronRight : ICONS.chevronDown}
					class="size-3.5 shrink-0 text-surface-600-400"
				/>
				<AppIcon name={ICONS.transcript} class="size-4 text-primary-500" />
				<p class="text-sm font-semibold">Transcript</p>
				<span class="badge preset-tonal-surface text-xs">{cues.length} cues</span>
			</div>
		</button>

		{#if !collapsed}
			<div class="flex flex-col">
				<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
				<div
					class="flex items-center gap-1 border-b border-surface-200-800 px-3 pt-2"
					onclick={(e) => e.stopPropagation()}
				>
					<button
						type="button"
						class="rounded-t-md border-b-2 px-2.5 py-1 text-xs font-medium transition-colors {tab ===
						'cues'
							? 'border-primary-500 text-primary-500'
							: 'border-transparent text-surface-600-400 hover:text-surface-950-50'}"
						onclick={() => (tab = 'cues')}
					>
						Cues
					</button>
					<button
						type="button"
						class="rounded-t-md border-b-2 px-2.5 py-1 text-xs font-medium transition-colors {tab ===
						'top'
							? 'border-primary-500 text-primary-500'
							: 'border-transparent text-surface-600-400 hover:text-surface-950-50'}"
						onclick={() => (tab = 'top')}
					>
						Top words
					</button>
				</div>

				{#if tab === 'cues'}
					<div class="flex flex-col">
						<div class="flex items-center gap-2 border-b border-surface-200-800 px-3 py-2">
							<AppIcon name={ICONS.search} class="size-3.5 shrink-0 text-surface-600-400" />
							<input
								bind:value={search}
								type="text"
								placeholder="Search transcript…"
								class="flex-1 bg-transparent text-sm outline-none placeholder:text-surface-600-400"
							/>
							{#if search}
								<button
									type="button"
									class="text-surface-600-400 hover:text-surface-950-50"
									aria-label="Clear search"
									onclick={() => (search = '')}
								>
									<AppIcon name={ICONS.close} class="size-3.5" />
								</button>
							{/if}
							<span class="shrink-0 text-[11px] text-surface-600-400 tabular-nums">
								{filteredCues.length}/{cues.length}
							</span>
						</div>

						{#if filteredCues.length > 0}
							<ul
								bind:this={listRef}
								class="flex max-h-80 flex-col divide-y divide-surface-200-800 overflow-y-auto"
							>
								{#each filteredCues as cue, idx (`${cue.startSeconds}-${idx}`)}
									<li
										class="transition-colors {idx === activeIndex
											? 'border-l-2 border-primary-500 bg-primary-500/10'
											: 'border-l-2 border-transparent hover:bg-surface-200-800/40'}"
									>
										<button
											type="button"
											class="flex w-full items-start gap-3 px-3 py-2 text-left"
											onclick={() => onseek?.(cue.startSeconds)}
										>
											<span
												class="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] tabular-nums {idx ===
												activeIndex
													? 'font-semibold text-primary-500'
													: 'text-surface-600-400'}"
											>
												{#if idx === activeIndex}
													<AppIcon name={ICONS.play} class="size-2.5" />
												{/if}
												{formatTime(cue.startSeconds)}
											</span>
											<span
												class="text-sm leading-snug {idx === activeIndex
													? 'text-surface-950-50'
													: 'text-surface-950-50/90'}"
											>
												{cue.text}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="px-3 py-4 text-center text-xs text-surface-600-400">
								No matches for "{search}".
							</p>
						{/if}
					</div>
				{:else}
					<div class="flex flex-col">
						<div
							class="flex items-center justify-between gap-2 border-b border-surface-200-800 px-3 py-2"
						>
							<p class="text-[11px] text-surface-600-400">
								Most-spoken words (stopwords excluded). Click to filter cues.
							</p>
							<label class="flex items-center gap-1.5 text-[11px] text-surface-600-400">
								<span>Top</span>
								<select
									bind:value={topCount}
									class="select rounded border border-surface-200-800 px-1 py-0.5 text-xs tabular-nums outline-none focus:border-primary-500"
								>
									{#each COUNT_OPTIONS as n (n)}
										<option value={n}>{n}</option>
									{/each}
								</select>
							</label>
						</div>

						{#if topWords.length > 0}
							<ul class="flex max-h-80 flex-col divide-y divide-surface-200-800 overflow-y-auto">
								{#each topWords as w, idx (w.word)}
									<li class="transition-colors hover:bg-surface-200-800/40">
										<button
											type="button"
											class="flex w-full items-center gap-3 px-3 py-2 text-left"
											onclick={() => pickWord(w.word)}
										>
											<span class="w-6 shrink-0 text-[11px] text-surface-600-400 tabular-nums">
												{idx + 1}.
											</span>
											<span class="flex-1 truncate text-sm font-medium">{w.word}</span>
											<div class="flex w-32 shrink-0 items-center gap-2">
												<div
													class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-200-800/70"
												>
													<div
														class="absolute inset-y-0 left-0 rounded-full bg-primary-500"
														style="width: {maxWordCount > 0 ? (w.count / maxWordCount) * 100 : 0}%;"
													></div>
												</div>
												<span class="w-8 text-right text-[11px] text-surface-600-400 tabular-nums">
													{w.count}
												</span>
											</div>
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="px-3 py-4 text-center text-xs text-surface-600-400">No words to count.</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
