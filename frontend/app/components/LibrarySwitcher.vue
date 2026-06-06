<script setup lang="ts">
import { ICONS } from "~/utils/icons";
import type { Library } from "~~/shared/types/api";
import type { DropdownMenuItem } from "@nuxt/ui";

/**
 * Account-switcher style control at the top of the sidebar. The trigger shows
 * the library you're currently in; opening it reveals every other library so
 * you can switch with one click. The default library is always pinned to the
 * top of the list, and the current library is marked with a check.
 */
const props = defineProps<{
  libraries: Library[] | null;
  currentLibraryId: string | null;
}>();

const emit = defineEmits<{ create: [] }>();

const router = useRouter();

const current = computed(() => {
  const libs = props.libraries ?? [];
  return (
    libs.find((l) => l.id === props.currentLibraryId) ??
    libs.find((l) => l.isDefault) ??
    libs[0] ??
    null
  );
});

// Don't preventDefault here: the dropdown items are not links, so the only
// effect of preventDefault on a menu item's select event is to suppress the
// menu's auto-close — which left the switcher stuck open after a selection.
function go(id: string) {
  return () => {
    router.push({ path: `/libraries/${id}`, force: true });
  };
}

function toItem(l: Library): DropdownMenuItem {
  return {
    label: l.emoji ? `${l.emoji}  ${l.name}` : l.name,
    icon: l.emoji ? undefined : l.isDefault ? ICONS.library : ICONS.folder,
    slot: l.id === current.value?.id ? "active" : undefined,
    onSelect: go(l.id),
  };
}

const items = computed<DropdownMenuItem[][]>(() => {
  const libs = props.libraries ?? [];
  const def = libs.find((l) => l.isDefault);
  const others = libs.filter((l) => !l.isDefault).sort((a, b) => a.name.localeCompare(b.name));

  const groups: DropdownMenuItem[][] = [];
  if (def) groups.push([toItem(def)]);
  if (others.length) groups.push(others.map(toItem));
  groups.push([
    { label: "New library", icon: ICONS.plus, onSelect: () => emit("create") },
  ]);
  return groups;
});
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'start', sideOffset: 6 }"
    :ui="{ content: 'min-w-60' }"
  >
    <button
      type="button"
      class="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-elevated"
      :aria-label="`Switch library, current: ${current?.name ?? 'none'}`"
    >
      <span v-if="current?.emoji" class="shrink-0 text-lg leading-none">{{ current.emoji }}</span>
      <UIcon v-else :name="ICONS.library" class="size-5 shrink-0 text-muted" />
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{
        current?.name ?? "Select library"
      }}</span>
      <UIcon :name="ICONS.dropdownCaret" class="size-4 shrink-0 text-dimmed" />
    </button>

    <template #active-trailing>
      <UIcon :name="ICONS.check" class="size-4 text-primary" />
    </template>
  </UDropdownMenu>
</template>
