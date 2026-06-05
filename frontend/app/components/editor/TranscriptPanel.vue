<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import type { VttCue } from "~/utils/parse-vtt";

const props = defineProps<{
  cues: VttCue[];
  currentTime: number;
}>();

const emit = defineEmits<{
  seek: [seconds: number];
}>();

const collapsed = ref(false);
const tab = ref<"cues" | "top">("cues");
const search = ref("");
const topCount = ref(10);
const COUNT_OPTIONS = [5, 10, 20, 50, 100];

// Common English stopwords + transcription filler. Lowercase, no punctuation.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "up",
  "down",
  "out",
  "as",
  "if",
  "so",
  "than",
  "then",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "doing",
  "have",
  "has",
  "had",
  "having",
  "will",
  "would",
  "could",
  "should",
  "shall",
  "may",
  "might",
  "can",
  "must",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "yours",
  "his",
  "its",
  "our",
  "ours",
  "their",
  "theirs",
  "myself",
  "yourself",
  "himself",
  "herself",
  "itself",
  "ourselves",
  "themselves",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "not",
  "no",
  "yes",
  "yeah",
  "yep",
  "nope",
  "ok",
  "okay",
  "um",
  "uh",
  "oh",
  "ah",
  "hmm",
  "mm",
  "er",
  "like",
  "just",
  "really",
  "very",
  "so",
  "such",
  "too",
  "also",
  "there",
  "here",
  "all",
  "any",
  "some",
  "most",
  "more",
  "less",
  "few",
  "many",
  "much",
  "lot",
  "lots",
  "every",
  "each",
  "other",
  "another",
  "same",
  "own",
  "about",
  "into",
  "onto",
  "over",
  "under",
  "after",
  "before",
  "between",
  "through",
  "during",
  "above",
  "below",
  "again",
  "further",
  "still",
  "ever",
  "never",
  "always",
  "sometimes",
  "often",
  "now",
  "soon",
  "later",
  "going",
  "gonna",
  "wanna",
  "gotta",
  "got",
  "get",
  "go",
  "going",
]);

const filteredCues = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.cues;
  return props.cues.filter((c) => c.text.toLowerCase().includes(q));
});

const activeIndex = computed(() => {
  const t = props.currentTime;
  const list = filteredCues.value;
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

const topWords = computed<WordCount[]>(() => {
  const counts = new Map<string, number>();
  for (const c of props.cues) {
    const tokens = c.text.toLowerCase().match(/\b[a-z][a-z']*\b/g);
    if (!tokens) continue;
    for (const raw of tokens) {
      const word = raw.replace(/^'+|'+$/g, "");
      if (word.length < 2) continue;
      if (STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, topCount.value);
});

const maxWordCount = computed(() => topWords.value[0]?.count ?? 0);

const listRef = useTemplateRef<HTMLUListElement>("listRef");

watch([activeIndex, tab], ([idx, currentTab]) => {
  if (!import.meta.client) return;
  if (collapsed.value) return;
  if (currentTab !== "cues") return;
  if (idx < 0) return;
  const list = listRef.value;
  if (!list) return;
  const row = list.children[idx] as HTMLElement | undefined;
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

function pickWord(word: string) {
  search.value = word;
  tab.value = "cues";
}
</script>

<template>
  <div v-if="cues.length > 0" class="rounded-lg border border-default bg-default">
    <button
      type="button"
      class="flex items-center justify-between gap-2 w-full px-3 py-2 border-b border-default text-left hover:bg-elevated/40 transition-colors"
      :class="collapsed ? 'border-b-0' : ''"
      @click="collapsed = !collapsed"
    >
      <div class="flex items-center gap-2">
        <UIcon
          :name="collapsed ? 'i-lineicons-chevron-right' : 'i-lineicons-chevron-down'"
          class="size-3.5 text-muted shrink-0"
        />
        <UIcon name="i-lineicons-comment-1-text" class="size-4 text-primary" />
        <p class="text-sm font-semibold">Transcript</p>
        <UBadge color="neutral" variant="subtle" size="xs">{{ cues.length }} cues</UBadge>
      </div>
    </button>

    <div v-if="!collapsed" class="flex flex-col">
      <div class="flex items-center gap-1 px-3 pt-2 border-b border-default" @click.stop>
        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-t-md border-b-2 transition-colors"
          :class="
            tab === 'cues'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-default'
          "
          @click="tab = 'cues'"
        >
          Cues
        </button>
        <button
          type="button"
          class="px-2.5 py-1 text-xs font-medium rounded-t-md border-b-2 transition-colors"
          :class="
            tab === 'top'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-default'
          "
          @click="tab = 'top'"
        >
          Top words
        </button>
      </div>

      <div v-if="tab === 'cues'" class="flex flex-col">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-default">
          <UIcon name="i-lineicons-search" class="size-3.5 text-muted shrink-0" />
          <input
            v-model="search"
            type="text"
            placeholder="Search transcript…"
            class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            v-if="search"
            type="button"
            class="text-muted hover:text-default"
            aria-label="Clear search"
            @click="search = ''"
          >
            <UIcon name="i-lineicons-x" class="size-3.5" />
          </button>
          <span class="text-[11px] text-muted tabular-nums shrink-0">
            {{ filteredCues.length }}/{{ cues.length }}
          </span>
        </div>

        <ul
          v-if="filteredCues.length > 0"
          ref="listRef"
          class="flex flex-col divide-y divide-default max-h-80 overflow-y-auto"
        >
          <li
            v-for="(cue, idx) in filteredCues"
            :key="`${cue.startSeconds}-${idx}`"
            class="transition-colors"
            :class="
              idx === activeIndex
                ? 'bg-primary/10 border-l-2 border-primary'
                : 'border-l-2 border-transparent hover:bg-elevated/40'
            "
          >
            <button
              type="button"
              class="flex items-start gap-3 w-full px-3 py-2 text-left"
              @click="emit('seek', cue.startSeconds)"
            >
              <span
                class="flex items-center gap-1 text-[11px] tabular-nums shrink-0 mt-0.5"
                :class="idx === activeIndex ? 'text-primary font-semibold' : 'text-muted'"
              >
                <UIcon v-if="idx === activeIndex" name="i-lineicons-play" class="size-2.5" />
                {{ formatTime(cue.startSeconds) }}
              </span>
              <span
                class="text-sm leading-snug"
                :class="idx === activeIndex ? 'text-default' : 'text-default/90'"
              >
                {{ cue.text }}
              </span>
            </button>
          </li>
        </ul>
        <p v-else class="px-3 py-4 text-xs text-muted text-center">
          No matches for "{{ search }}".
        </p>
      </div>

      <div v-else class="flex flex-col">
        <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-default">
          <p class="text-[11px] text-muted">
            Most-spoken words (stopwords excluded). Click to filter cues.
          </p>
          <label class="flex items-center gap-1.5 text-[11px] text-muted">
            <span>Top</span>
            <select
              v-model.number="topCount"
              class="bg-default border border-default rounded px-1 py-0.5 text-xs tabular-nums outline-none focus:border-primary"
            >
              <option v-for="n in COUNT_OPTIONS" :key="n" :value="n">{{ n }}</option>
            </select>
          </label>
        </div>

        <ul
          v-if="topWords.length > 0"
          class="flex flex-col divide-y divide-default max-h-80 overflow-y-auto"
        >
          <li
            v-for="(w, idx) in topWords"
            :key="w.word"
            class="hover:bg-elevated/40 transition-colors"
          >
            <button
              type="button"
              class="flex items-center gap-3 w-full px-3 py-2 text-left"
              @click="pickWord(w.word)"
            >
              <span class="text-[11px] text-muted tabular-nums shrink-0 w-6"> {{ idx + 1 }}. </span>
              <span class="text-sm font-medium truncate flex-1">{{ w.word }}</span>
              <div class="flex items-center gap-2 shrink-0 w-32">
                <div class="relative flex-1 h-1.5 rounded-full bg-elevated/70 overflow-hidden">
                  <div
                    class="absolute inset-y-0 left-0 bg-primary rounded-full"
                    :style="{
                      width: `${maxWordCount > 0 ? (w.count / maxWordCount) * 100 : 0}%`,
                    }"
                  />
                </div>
                <span class="text-[11px] text-muted tabular-nums w-8 text-right">
                  {{ w.count }}
                </span>
              </div>
            </button>
          </li>
        </ul>
        <p v-else class="px-3 py-4 text-xs text-muted text-center">No words to count.</p>
      </div>
    </div>
  </div>
</template>
