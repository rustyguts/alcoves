<script setup lang="ts">
interface Props {
  entryViewMode: "file" | "card";
  showTrashed: boolean;
}

defineProps<Props>();
</script>

<template>
  <table v-if="entryViewMode === 'file'" class="w-full">
    <thead class="sticky top-0 z-10 shadow-[0_1px_0_0] shadow-base-300/70">
      <tr>
        <th class="w-12 px-4 py-3 bg-base-100/90 backdrop-blur-sm rounded-tl-lg" />
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm"
        >
          Name
        </th>
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm"
        >
          Tags
        </th>
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm hidden sm:table-cell"
        >
          Owner
        </th>
        <th
          class="text-left text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm hidden sm:table-cell"
        >
          {{ showTrashed ? "Trashed" : "Modified" }}
        </th>
        <th
          class="text-right text-xs font-medium text-muted px-4 py-3 bg-base-100/90 backdrop-blur-sm hidden sm:table-cell rounded-tr-lg"
        >
          Size
        </th>
      </tr>
    </thead>
    <tbody class="select-none">
      <tr v-for="i in 8" :key="i">
        <td class="px-4 py-3">
          <div class="skeleton h-5 w-5 rounded" />
        </td>
        <td class="px-4 py-3">
          <div class="skeleton h-4 rounded" :style="{ width: `${40 + ((i * 17) % 40)}%` }" />
        </td>
        <td class="px-4 py-3">
          <div class="skeleton h-3 w-8 rounded-full" />
        </td>
        <td class="px-4 py-3 hidden sm:table-cell">
          <div class="skeleton h-6 w-6 rounded-full" />
        </td>
        <td class="px-4 py-3 hidden sm:table-cell">
          <div class="skeleton h-4 w-20 rounded" />
        </td>
        <td class="px-4 py-3 hidden sm:table-cell">
          <div class="skeleton h-4 w-14 rounded ml-auto" />
        </td>
      </tr>
    </tbody>
  </table>

  <div v-else class="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
    <div v-for="i in 8" :key="i" class="rounded-lg bg-elevated/50 p-3">
      <div class="skeleton h-40 w-full rounded-md mb-3" />
      <div class="skeleton h-4 rounded mb-2" :style="{ width: `${50 + ((i * 13) % 40)}%` }" />
      <div class="skeleton h-3 w-16 rounded" />
    </div>
  </div>
</template>
