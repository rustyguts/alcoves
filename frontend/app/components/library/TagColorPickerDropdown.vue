<script setup lang="ts">
import AppIcon from "~/components/AppIcon.vue";

interface Props {
  open: boolean;
  color: string;
  draft: string;
  palette: readonly string[];
  keyId: string;
  title?: string;
}

withDefaults(defineProps<Props>(), {
  title: "Select tag color",
});

const emit = defineEmits<{
  toggle: [];
  pick: [color: string];
  updateDraft: [value: string];
  commitDraft: [];
}>();
</script>

<template>
  <details class="dropdown" data-color-dropdown :open="open">
    <summary
      class="btn btn-soft btn-sm btn-circle btn-ghost p-0"
      :title="title"
      @click.prevent="emit('toggle')"
    >
      <span class="size-4 rounded-full" :style="{ backgroundColor: color }" />
    </summary>
    <div
      class="dropdown-content rounded-box z-20 mt-2 w-52 border border-base-300/80 bg-base-100 p-4 shadow-xl"
    >
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="entry in palette"
          :key="`${keyId}-${entry}`"
          type="button"
          class="relative size-9 rounded-full border border-base-300 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
          :class="entry === color.toUpperCase() ? 'ring-2 ring-primary/40' : ''"
          :style="{ backgroundColor: entry }"
          :title="entry"
          @click="emit('pick', entry)"
        >
          <AppIcon
            v-if="entry === color.toUpperCase()"
            name="i-lucide-check"
            class="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow"
          />
        </button>
      </div>
      <input
        :value="draft"
        class="input input-sm mt-2 w-full font-mono uppercase"
        placeholder="#3B82F6"
        @input="emit('updateDraft', ($event.target as HTMLInputElement).value)"
        @blur="emit('commitDraft')"
        @keydown.enter.prevent="emit('commitDraft')"
      />
    </div>
  </details>
</template>
