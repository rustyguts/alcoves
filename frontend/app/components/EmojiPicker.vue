<script setup lang="ts">
import AppIcon from "~/components/AppIcon.vue";

const props = defineProps<{
  modelValue: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string | null];
}>();

const open = ref(false);
const pickerRef = ref<HTMLElement | null>(null);

const emojiCategories = [
  {
    label: "Smileys",
    emojis: [
      "\u{1F60A}",
      "\u{1F604}",
      "\u{1F60E}",
      "\u{1F525}",
      "\u{2764}\u{FE0F}",
      "\u{2B50}",
      "\u{1F31F}",
      "\u{26A1}",
      "\u{1F3AF}",
      "\u{1F680}",
      "\u{1F389}",
      "\u{1F381}",
      "\u{1F48E}",
      "\u{1F451}",
      "\u{1F3C6}",
      "\u{1F3B5}",
    ],
  },
  {
    label: "Nature",
    emojis: [
      "\u{1F33A}",
      "\u{1F333}",
      "\u{1F335}",
      "\u{1F340}",
      "\u{1F341}",
      "\u{1F330}",
      "\u{1F338}",
      "\u{1F337}",
      "\u{1F331}",
      "\u{1F30A}",
      "\u{2600}\u{FE0F}",
      "\u{1F308}",
      "\u{26C5}",
      "\u{2744}\u{FE0F}",
      "\u{1F30D}",
      "\u{1F319}",
    ],
  },
  {
    label: "Animals",
    emojis: [
      "\u{1F436}",
      "\u{1F431}",
      "\u{1F43B}",
      "\u{1F98A}",
      "\u{1F981}",
      "\u{1F985}",
      "\u{1F427}",
      "\u{1F422}",
      "\u{1F40B}",
      "\u{1F42C}",
      "\u{1F99C}",
      "\u{1F98B}",
      "\u{1F41D}",
      "\u{1F419}",
      "\u{1F40D}",
      "\u{1F98E}",
    ],
  },
  {
    label: "Food",
    emojis: [
      "\u{1F34E}",
      "\u{1F352}",
      "\u{1F353}",
      "\u{1F34A}",
      "\u{1F347}",
      "\u{1F349}",
      "\u{1F370}",
      "\u{1F354}",
      "\u{1F355}",
      "\u{1F32E}",
      "\u{2615}",
      "\u{1F37A}",
      "\u{1F377}",
      "\u{1F375}",
      "\u{1F366}",
      "\u{1F36D}",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "\u{1F4D6}",
      "\u{1F4DA}",
      "\u{1F4F7}",
      "\u{1F3A8}",
      "\u{1F3B6}",
      "\u{1F3AC}",
      "\u{1F4BB}",
      "\u{1F52C}",
      "\u{1F4A1}",
      "\u{1F513}",
      "\u{1F4E6}",
      "\u{1F4CC}",
      "\u{270F}\u{FE0F}",
      "\u{1F4DD}",
      "\u{1F4C1}",
      "\u{1F5C2}\u{FE0F}",
    ],
  },
  {
    label: "Travel",
    emojis: [
      "\u{2708}\u{FE0F}",
      "\u{1F697}",
      "\u{1F6A2}",
      "\u{1F682}",
      "\u{1F3D4}\u{FE0F}",
      "\u{1F3D6}\u{FE0F}",
      "\u{1F3E0}",
      "\u{1F3F0}",
      "\u{26FA}",
      "\u{1F5FA}\u{FE0F}",
      "\u{1F3DD}\u{FE0F}",
      "\u{1F30B}",
      "\u{1F6A1}",
      "\u{1F3ED}",
      "\u{1F3EB}",
      "\u{26F5}",
    ],
  },
];

function selectEmoji(emoji: string) {
  emit("update:modelValue", emoji);
  open.value = false;
}

function clearEmoji() {
  emit("update:modelValue", null);
  open.value = false;
}

function handleClickOutside(event: MouseEvent) {
  if (pickerRef.value && !pickerRef.value.contains(event.target as Node)) {
    open.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("click", handleClickOutside, true);
  } else {
    document.removeEventListener("click", handleClickOutside, true);
  }
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside, true);
});
</script>

<template>
  <div ref="pickerRef" class="relative inline-block">
    <button
      type="button"
      class="btn btn-ghost btn-square"
      title="Choose emoji icon"
      @click.stop="open = !open"
    >
      <span v-if="modelValue" class="text-2xl leading-none">{{ modelValue }}</span>
      <AppIcon v-else name="i-lucide-smile-plus" class="size-5 text-muted" />
    </button>

    <div
      v-if="open"
      class="absolute left-0 top-full mt-2 z-50 bg-base-100 rounded-box shadow-lg border border-base-300 p-3 w-72"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-base-content/60">Pick an icon</span>
        <button v-if="modelValue" type="button" class="btn btn-ghost btn-xs" @click="clearEmoji">
          Remove
        </button>
      </div>
      <div v-for="category in emojiCategories" :key="category.label" class="mb-2 last:mb-0">
        <p class="text-xs text-base-content/50 mb-1">{{ category.label }}</p>
        <div class="grid grid-cols-8 gap-0.5">
          <button
            v-for="emoji in category.emojis"
            :key="emoji"
            type="button"
            class="btn btn-ghost btn-sm btn-square text-lg"
            :class="modelValue === emoji ? 'bg-primary/20' : ''"
            @click="selectEmoji(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
