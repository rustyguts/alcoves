<script setup lang="ts">
const open = defineModel<boolean>("open", { default: false });

interface Shortcut {
  keys: string[];
  description: string;
}

const sections: { title: string; items: Shortcut[] }[] = [
  {
    title: "Timeline",
    items: [
      { keys: ["Z"], description: "Zoom in" },
      { keys: ["X"], description: "Zoom out" },
      { keys: ["A"], description: "Scroll left" },
      { keys: ["D"], description: "Scroll right" },
      { keys: ["C"], description: "Center on playhead" },
    ],
  },
  {
    title: "Moments",
    items: [
      { keys: ["M"], description: "New moment at playhead" },
      { keys: ["I"], description: "Set selected moment start to playhead" },
      { keys: ["O"], description: "Set selected moment end to playhead" },
    ],
  },
  {
    title: "Playback",
    items: [{ keys: ["Space"], description: "Play / pause" }],
  },
];
</script>

<template>
  <UModal v-model:open="open" title="Keyboard shortcuts" :ui="{ content: 'max-w-lg' }">
    <template #body>
      <div class="flex flex-col gap-5">
        <section v-for="section in sections" :key="section.title">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            {{ section.title }}
          </p>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="item in section.items"
              :key="item.description"
              class="flex items-center justify-between gap-4 text-sm"
            >
              <span class="text-default">{{ item.description }}</span>
              <span class="flex items-center gap-1">
                <kbd
                  v-for="k in item.keys"
                  :key="k"
                  class="px-1.5 py-0.5 rounded bg-elevated border border-default text-[11px] font-mono"
                >
                  {{ k }}
                </kbd>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UModal>
</template>
