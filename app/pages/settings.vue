<script setup lang="ts">
import { h, resolveComponent } from "vue";
import type { TableColumn } from "@nuxt/ui";

definePageMeta({
  layout: "dashboard",
});

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
}

const UAvatar = resolveComponent("UAvatar");
const UBadge = resolveComponent("UBadge");

const { data: users, status } = await useFetch<AdminUser[]>("/api/admin/users");

const columns: TableColumn<AdminUser>[] = [
  {
    accessorKey: "displayName",
    header: "Name",
    cell: ({ row }) => {
      return h("div", { class: "flex items-center gap-2" }, [
        h(UAvatar, {
          src: row.original.avatarUrl ?? undefined,
          alt: row.original.displayName,
          size: "xs",
        }),
        h("span", row.original.displayName),
      ]);
    },
  },
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => {
      return h(
        UBadge,
        {
          color: row.original.role === "owner" ? "primary" : "neutral",
          variant: "subtle",
          size: "sm",
        },
        () => row.original.role,
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: "Joined",
    cell: ({ row }) => {
      return new Date(row.original.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
  },
];
</script>

<template>
  <div class="mx-auto max-w-4xl flex flex-col gap-8">
    <div>
      <h1 class="text-xl font-semibold">Settings</h1>
      <p class="text-sm text-muted mt-1">
        Server administration settings. Only visible to the server owner.
      </p>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-medium">Users</h2>
        <UBadge v-if="users" color="neutral" variant="subtle">
          {{ users.length }} {{ users.length === 1 ? "user" : "users" }}
        </UBadge>
      </div>

      <UTable v-if="status === 'success' && users" :data="users" :columns="columns" />

      <div v-else-if="status === 'pending'" class="flex items-center justify-center py-8">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
      </div>
    </div>
  </div>
</template>
