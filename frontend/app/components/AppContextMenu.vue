<script setup lang="ts">
interface Position {
  x: number;
  y: number;
}

interface Props {
  open: boolean;
  position: Position | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
const adjustedPosition = ref<Position | null>(null);

function clampPosition() {
  const panel = panelRef.value;
  const position = props.position;
  if (!panel || !position) return;

  const margin = 8;
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const maxX = window.innerWidth - panelWidth - margin;
  const maxY = window.innerHeight - panelHeight - margin;

  adjustedPosition.value = {
    x: Math.max(margin, Math.min(position.x, maxX)),
    y: Math.max(margin, Math.min(position.y, maxY)),
  };
}

watch(
  () => [props.open, props.position?.x, props.position?.y],
  async () => {
    if (!props.open || !props.position) {
      adjustedPosition.value = null;
      return;
    }

    adjustedPosition.value = { ...props.position };
    await nextTick();
    clampPosition();
  },
);

onMounted(() => window.addEventListener("resize", clampPosition));
onUnmounted(() => window.removeEventListener("resize", clampPosition));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && adjustedPosition"
      class="fixed inset-0 z-40"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        ref="panelRef"
        class="absolute z-50 min-w-44 rounded-lg bg-default border border-default shadow-lg p-1"
        :style="{
          left: `${adjustedPosition.x}px`,
          top: `${adjustedPosition.y}px`,
        }"
        @click.stop
      >
        <ul class="flex flex-col">
          <slot />
        </ul>
      </div>
    </div>
  </Teleport>
</template>
