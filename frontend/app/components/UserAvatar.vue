<script setup lang="ts">
interface Props {
  displayName: string;
  avatarUrl?: string | null;
  sizeClass?: string;
  textSizeClass?: string;
  bgClass?: string;
  roundedClass?: string;
  tooltip?: boolean;
  tooltipPosition?: "top" | "bottom" | "left" | "right";
}

const props = withDefaults(defineProps<Props>(), {
  avatarUrl: null,
  sizeClass: "w-8",
  textSizeClass: "text-xs",
  bgClass: "bg-neutral text-neutral-content",
  roundedClass: "rounded-full",
  tooltip: false,
  tooltipPosition: "right",
});

const initial = computed(() => props.displayName.trim().charAt(0).toUpperCase() || "U");
</script>

<template>
  <div
    class="avatar placeholder"
    :class="props.tooltip ? `tooltip tooltip-${props.tooltipPosition}` : ''"
    :data-tip="props.tooltip ? props.displayName : undefined"
  >
    <div v-if="props.avatarUrl" :class="[props.sizeClass, props.roundedClass, 'overflow-hidden']">
      <img :src="props.avatarUrl" :alt="props.displayName" class="size-full object-cover" />
    </div>
    <div
      v-else
      :class="[
        props.sizeClass,
        props.roundedClass,
        props.bgClass,
        props.textSizeClass,
        'flex items-center justify-center font-semibold',
      ]"
    >
      {{ initial }}
    </div>
  </div>
</template>
