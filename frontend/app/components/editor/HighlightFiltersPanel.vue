<script setup lang="ts">
import { ref, computed } from "vue";
import type {
  HighlightFilter,
  HighlightFilterCreate,
  HighlightFilterPatch,
} from "~~/shared/types/api";
import type { FilterAggregate, FilterMatch } from "~/composables/useHighlightFilters";

const props = defineProps<{
  filters: HighlightFilter[];
  matches: Record<string, FilterMatch[]>;
  aggregates: Record<string, FilterAggregate>;
  loading?: boolean;
  hasSignals: boolean;
}>();

const emit = defineEmits<{
  seek: [seconds: number];
  create: [body: HighlightFilterCreate];
  update: [id: string, body: HighlightFilterPatch];
  remove: [id: string];
  "load-presets": [];
}>();

const expanded = ref<Set<string>>(new Set());
const editing = ref<string | null>(null);
const collapsed = ref(true);

interface DraftState {
  name: string;
  expression: string;
  proximitySeconds: number;
  color: string;
}

const adding = ref(false);
const draft = ref<DraftState>(blankDraft());

function blankDraft(): DraftState {
  return { name: "", expression: "", proximitySeconds: 5, color: "#3B82F6" };
}

function startAdd() {
  draft.value = blankDraft();
  adding.value = true;
  editing.value = null;
}

function cancelAdd() {
  adding.value = false;
  draft.value = blankDraft();
}

function submitAdd() {
  const d = draft.value;
  if (!d.name.trim() || !d.expression.trim()) return;
  emit("create", {
    name: d.name.trim(),
    expression: d.expression.trim(),
    proximitySeconds: d.proximitySeconds,
    color: d.color,
  });
  cancelAdd();
}

function startEdit(f: HighlightFilter) {
  editing.value = f.id;
  draft.value = {
    name: f.name,
    expression: f.expression,
    proximitySeconds: f.proximitySeconds,
    color: f.color,
  };
  adding.value = false;
}

function cancelEdit() {
  editing.value = null;
}

function submitEdit(id: string) {
  const d = draft.value;
  if (!d.name.trim() || !d.expression.trim()) return;
  emit("update", id, {
    name: d.name.trim(),
    expression: d.expression.trim(),
    proximitySeconds: d.proximitySeconds,
    color: d.color,
  });
  editing.value = null;
}

function toggleExpand(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

function joinEvidence(ev: string[]): string {
  return ev.map((s) => `"${s}"`).join(" + ");
}

const sortedFilters = computed(() =>
  [...props.filters].sort((a, b) => {
    const aCount = props.aggregates[a.id]?.count ?? 0;
    const bCount = props.aggregates[b.id]?.count ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.name.localeCompare(b.name);
  }),
);
</script>

<template>
  <div v-if="hasSignals || filters.length > 0" class="rounded-md bg-elevated/50">
    <button
      type="button"
      class="flex items-center justify-between gap-2 w-full px-3 py-2 border-b border-default text-left hover:bg-elevated/40 transition-colors"
      :class="collapsed ? 'border-b-0' : ''"
      @click="collapsed = !collapsed"
    >
      <div class="flex items-center gap-2 min-w-0">
        <UIcon
          :name="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
          class="size-3.5 text-muted shrink-0"
        />
        <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
        <p class="text-sm font-semibold">Highlight filters</p>
        <UBadge color="neutral" variant="subtle" size="xs">{{ filters.length }}</UBadge>
        <UTooltip
          text="Comma = OR · &amp; = AND · word:foo = transcript · audio:foo = label · :25 = min %"
        >
          <UIcon name="i-lucide-help-circle" class="size-3.5 text-muted" />
        </UTooltip>
      </div>
      <div class="flex items-center gap-1 shrink-0" @click.stop>
        <UButton
          v-if="!collapsed && filters.length === 0"
          color="primary"
          variant="soft"
          size="xs"
          icon="i-lucide-wand-2"
          :loading="loading"
          @click="emit('load-presets')"
        >
          Load presets
        </UButton>
        <UButton
          v-if="!collapsed"
          color="primary"
          variant="solid"
          size="xs"
          icon="i-lucide-plus"
          @click="startAdd"
        >
          Add filter
        </UButton>
      </div>
    </button>

    <template v-if="!collapsed">
      <!-- Add form -->
      <div v-if="adding" class="px-3 py-2 border-b border-default bg-elevated/50">
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-end gap-2">
            <div class="flex flex-col gap-1 w-40">
              <label class="text-[11px] font-medium text-muted">Name</label>
              <UInput v-model="draft.name" size="xs" placeholder="Funny clip" />
            </div>
            <div class="flex flex-col gap-1 flex-1 min-w-[260px]">
              <label class="text-[11px] font-medium text-muted">
                Expression <span class="text-dimmed">(comma = OR, &amp; = AND)</span>
              </label>
              <UInput
                v-model="draft.expression"
                size="xs"
                placeholder='laughter:25, screaming &amp; word:wtf, "machine gun":40'
              />
            </div>
            <div class="flex flex-col gap-1 w-24">
              <label class="text-[11px] font-medium text-muted">
                AND ± {{ draft.proximitySeconds }}s
              </label>
              <UInput
                v-model.number="draft.proximitySeconds"
                type="range"
                min="0"
                max="30"
                step="1"
                size="xs"
              />
            </div>
            <div class="flex flex-col gap-1 w-12">
              <label class="text-[11px] font-medium text-muted">Color</label>
              <input
                v-model="draft.color"
                type="color"
                class="h-7 w-10 rounded border border-default cursor-pointer"
              />
            </div>
            <div class="flex items-center gap-1">
              <UButton color="neutral" variant="ghost" size="xs" @click="cancelAdd">
                Cancel
              </UButton>
              <UButton color="primary" size="xs" icon="i-lucide-check" @click="submitAdd">
                Save
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <ul v-if="sortedFilters.length > 0" class="flex flex-col divide-y divide-default">
        <li v-for="f in sortedFilters" :key="f.id" class="px-3 py-2">
          <!-- Edit form -->
          <div v-if="editing === f.id" class="flex flex-wrap items-end gap-2">
            <div class="flex flex-col gap-1 w-40">
              <label class="text-[11px] font-medium text-muted">Name</label>
              <UInput v-model="draft.name" size="xs" />
            </div>
            <div class="flex flex-col gap-1 flex-1 min-w-[260px]">
              <label class="text-[11px] font-medium text-muted">Expression</label>
              <UInput v-model="draft.expression" size="xs" />
            </div>
            <div class="flex flex-col gap-1 w-24">
              <label class="text-[11px] font-medium text-muted">
                AND ± {{ draft.proximitySeconds }}s
              </label>
              <UInput
                v-model.number="draft.proximitySeconds"
                type="range"
                min="0"
                max="30"
                step="1"
                size="xs"
              />
            </div>
            <div class="flex flex-col gap-1 w-12">
              <label class="text-[11px] font-medium text-muted">Color</label>
              <input
                v-model="draft.color"
                type="color"
                class="h-7 w-10 rounded border border-default cursor-pointer"
              />
            </div>
            <div class="flex items-center gap-1">
              <UButton color="neutral" variant="ghost" size="xs" @click="cancelEdit">
                Cancel
              </UButton>
              <UButton color="primary" size="xs" icon="i-lucide-check" @click="submitEdit(f.id)">
                Save
              </UButton>
            </div>
          </div>

          <!-- Row -->
          <div v-else class="flex items-center gap-2 min-w-0">
            <button
              type="button"
              class="flex items-center gap-2 min-w-0 flex-1 text-left"
              @click="toggleExpand(f.id)"
            >
              <UIcon
                :name="expanded.has(f.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-3.5 text-muted shrink-0"
              />
              <span class="size-2.5 rounded-full shrink-0" :style="{ backgroundColor: f.color }" />
              <span class="text-sm font-medium truncate">{{ f.name }}</span>
              <code class="text-[11px] text-dimmed truncate font-mono">{{ f.expression }}</code>
              <UBadge
                v-if="(aggregates[f.id]?.expressionErrors?.length ?? 0) > 0"
                color="warning"
                variant="subtle"
                size="xs"
                class="shrink-0"
                :title="aggregates[f.id]?.expressionErrors.join('; ')"
              >
                parse error
              </UBadge>
            </button>

            <div class="flex items-center gap-1.5 shrink-0">
              <UBadge
                :color="(aggregates[f.id]?.count ?? 0) > 0 ? 'primary' : 'neutral'"
                variant="soft"
                size="xs"
              >
                {{ aggregates[f.id]?.count ?? 0 }} hits
              </UBadge>
              <span
                v-if="(aggregates[f.id]?.count ?? 0) > 0"
                class="text-[10px] text-muted tabular-nums"
              >
                avg {{ ((aggregates[f.id]?.meanScore ?? 0) * 100).toFixed(0) }}% · max
                {{ ((aggregates[f.id]?.maxScore ?? 0) * 100).toFixed(0) }}%
              </span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-pencil"
                square
                @click="startEdit(f)"
              />
              <UButton
                color="error"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                square
                @click="emit('remove', f.id)"
              />
            </div>
          </div>

          <!-- Expanded match list -->
          <ul
            v-if="expanded.has(f.id) && (matches[f.id]?.length ?? 0) > 0"
            class="mt-2 flex flex-wrap gap-1 pl-5"
          >
            <li v-for="(m, i) in matches[f.id]" :key="i">
              <button
                type="button"
                class="flex items-center gap-1 px-2 py-0.5 rounded-md border border-default text-[11px] hover:border-primary hover:bg-elevated tabular-nums"
                :title="joinEvidence(m.evidence)"
                @click="emit('seek', m.startSeconds)"
              >
                <UIcon name="i-lucide-play" class="size-2.5" />
                {{ formatTime(m.startSeconds) }}
                <span class="text-muted">· {{ (m.score * 100).toFixed(0) }}%</span>
                <span class="text-dimmed truncate max-w-[220px]">
                  {{ joinEvidence(m.evidence) }}
                </span>
              </button>
            </li>
          </ul>
        </li>
      </ul>

      <div v-else-if="!adding" class="px-3 py-4 text-center text-xs text-muted">
        No filters yet. Click <span class="font-medium">Add filter</span> or
        <span class="font-medium">Load presets</span> to get started.
      </div>
    </template>
  </div>
</template>
