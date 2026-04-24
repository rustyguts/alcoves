<script setup lang="ts">
import AppIcon from "~/components/AppIcon.vue";

interface MenuItem {
  label: string;
  icon?: string;
  color?: "error";
  disabled?: boolean;
  children?: MenuItem[];
}

interface Props {
  groups: MenuItem[][];
}

defineProps<Props>();

const emit = defineEmits<{
  select: [item: MenuItem];
}>();
</script>

<template>
  <template v-for="(group, groupIndex) in groups" :key="groupIndex">
    <li v-if="groupIndex > 0" class="my-1" role="separator">
      <div class="h-px w-full bg-accented/80" />
    </li>
    <template v-for="(item, itemIndex) in group" :key="`${groupIndex}-${itemIndex}-${item.label}`">
      <li v-if="item.children?.length">
        <details class="group">
          <summary
            class="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-elevated/70 list-none"
            :class="item.color === 'error' ? 'text-error' : ''"
          >
            <AppIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
            <span class="flex-1">{{ item.label }}</span>
            <AppIcon
              name="i-lucide-chevron-right"
              class="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-90"
            />
          </summary>
          <ul class="ml-3 mt-0.5 flex flex-col border-l border-default pl-1">
            <li
              v-for="(child, childIndex) in item.children"
              :key="`${item.label}-${childIndex}-${child.label}`"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-elevated/70 disabled:cursor-not-allowed disabled:opacity-50"
                :class="child.color === 'error' ? 'text-error' : ''"
                :disabled="child.disabled"
                @click="emit('select', child)"
              >
                <AppIcon v-if="child.icon" :name="child.icon" class="size-4 shrink-0" />
                <span>{{ child.label }}</span>
              </button>
            </li>
          </ul>
        </details>
      </li>
      <li v-else>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-elevated/70 disabled:cursor-not-allowed disabled:opacity-50"
          :class="item.color === 'error' ? 'text-error' : ''"
          :disabled="item.disabled"
          @click="emit('select', item)"
        >
          <AppIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
          <span>{{ item.label }}</span>
        </button>
      </li>
    </template>
  </template>
</template>
