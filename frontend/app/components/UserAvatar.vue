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
  bgClass: "",
  roundedClass: "",
  tooltip: false,
  tooltipPosition: "right",
});

const size = computed<"3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl">(() => {
  const c = props.sizeClass;
  if (c.includes("w-6") || c.includes("size-6")) return "xs";
  if (c.includes("w-8") || c.includes("size-8")) return "sm";
  if (c.includes("w-10") || c.includes("size-10")) return "md";
  if (c.includes("w-12") || c.includes("size-12")) return "lg";
  if (c.includes("w-14") || c.includes("size-14")) return "xl";
  if (c.includes("w-16") || c.includes("size-16")) return "2xl";
  if (c.includes("w-20") || c.includes("size-20")) return "3xl";
  if (c.includes("w-5") || c.includes("size-5")) return "2xs";
  if (c.includes("w-4") || c.includes("size-4")) return "3xs";
  return "sm";
});

const alt = computed(() => props.displayName);
const initial = computed(() => props.displayName.charAt(0).toUpperCase());
const resolvedSrc = computed(() => (props.avatarUrl ? apiUrl(props.avatarUrl) : undefined));
</script>

<template>
  <UTooltip v-if="tooltip" :text="displayName" :content="{ side: tooltipPosition }">
    <UAvatar :src="resolvedSrc" :alt="alt" :text="initial" :size="size" />
  </UTooltip>
  <UAvatar v-else :src="resolvedSrc" :alt="alt" :text="initial" :size="size" />
</template>
