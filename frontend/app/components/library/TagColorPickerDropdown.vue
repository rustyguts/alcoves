<script setup lang="ts">
import { ICONS } from "~/utils/icons";
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
  <div class="relative inline-block" data-color-dropdown>
    <button
      type="button"
      class="inline-flex items-center justify-center size-8 rounded-full hover:bg-elevated/70 transition-colors"
      :title="title"
      @click.prevent="emit('toggle')"
    >
      <span class="size-4 rounded-full" :style="{ backgroundColor: color }" />
    </button>
    <div
      v-if="open"
      class="absolute left-0 top-full z-20 mt-2 w-52 rounded-xl border border-default bg-default p-4 shadow-lg"
    >
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="entry in palette"
          :key="`${keyId}-${entry}`"
          type="button"
          class="relative size-9 rounded-full border border-default transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
          :class="entry === color.toUpperCase() ? 'ring-2 ring-primary/40' : ''"
          :style="{ backgroundColor: entry }"
          :title="entry"
          @click="emit('pick', entry)"
        >
          <AppIcon
            v-if="entry === color.toUpperCase()"
            :name="ICONS.check"
            class="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow"
          />
        </button>
      </div>
      <UInput
        :model-value="draft"
        size="sm"
        placeholder="#3B82F6"
        class="mt-2 font-mono uppercase"
        :ui="{ root: 'w-full' }"
        @update:model-value="emit('updateDraft', String($event ?? ''))"
        @blur="emit('commitDraft')"
        @keydown.enter.prevent="emit('commitDraft')"
      />
    </div>
  </div>
</template>
