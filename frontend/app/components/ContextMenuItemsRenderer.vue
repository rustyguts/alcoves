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
    <li v-if="groupIndex > 0" class="menu-title my-1 p-0">
      <div class="h-px w-full bg-base-300/80" />
    </li>
    <template v-for="(item, itemIndex) in group" :key="`${groupIndex}-${itemIndex}-${item.label}`">
      <li v-if="item.children?.length">
        <details>
          <summary
            :class="[
              item.color === 'error' ? 'text-error' : '',
              'px-2 py-1.5 gap-2 whitespace-nowrap',
            ]"
          >
            <AppIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
            <span>{{ item.label }}</span>
          </summary>
          <ul>
            <li
              v-for="(child, childIndex) in item.children"
              :key="`${item.label}-${childIndex}-${child.label}`"
            >
              <button
                type="button"
                :class="[
                  child.color === 'error' ? 'text-error' : '',
                  'px-2 py-1.5 gap-2 whitespace-nowrap',
                ]"
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
          :class="[
            item.color === 'error' ? 'text-error' : '',
            'px-2 py-1.5 gap-2 whitespace-nowrap',
          ]"
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
