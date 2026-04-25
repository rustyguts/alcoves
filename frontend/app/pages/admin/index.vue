<script setup lang="ts">
import { useAuth } from "~/composables/useAuth";
import { useApiFetch } from "~/composables/useApiFetch";
import { api } from "~/api";
import { formatFileSize } from "~/utils/mime-icons";
import { useToast } from "~/composables/useToast";
import AdminJobsPanel from "~/components/admin/AdminJobsPanel.vue";
import UserAvatar from "~/components/UserAvatar.vue";
import type { AdminStats, AdminUser } from "~~/shared/types/api";
import type { TableColumn } from "@nuxt/ui";
import { h, resolveComponent } from "vue";

definePageMeta({ layout: "dashboard" });

const toast = useToast();
const { user: currentUser } = useAuth();

const { data: stats } = useApiFetch<AdminStats>("/api/admin/stats");
const { data: users, status: usersStatus } = useApiFetch<AdminUser[]>("/api/admin/users");

const roleDrafts = reactive<Record<string, AdminUser["role"]>>({});
const updatingRoleUserId = ref<string | null>(null);

watchEffect(() => {
  if (!users.value) return;
  for (const user of users.value) {
    roleDrafts[user.id] = user.role;
  }
});

async function updateUserRole(user: AdminUser, nextRole: AdminUser["role"]) {
  if (!nextRole || nextRole === user.role) return;
  updatingRoleUserId.value = user.id;
  try {
    const updated = await api.admin.updateUserRole(user.id, { role: nextRole });
    user.role = updated.role;
    roleDrafts[user.id] = updated.role;
    toast.add({ title: "Role updated", color: "success" });
  } catch (error: unknown) {
    roleDrafts[user.id] = user.role;
    const message = error instanceof Error ? error.message : "Failed to update role";
    toast.add({ title: message, color: "error" });
  } finally {
    updatingRoleUserId.value = null;
  }
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface StatCard {
  key: string;
  title: string;
  value: string;
  caption: string;
  icon: string;
  color: string;
}

const statCards = computed<StatCard[]>(() => [
  {
    key: "files",
    title: "Files",
    value: stats.value?.files?.toLocaleString("en-US") ?? "—",
    caption: "Active across all libraries",
    icon: "i-lucide-files",
    color: "text-primary bg-primary-500/10",
  },
  {
    key: "storage",
    title: "Storage",
    value: stats.value ? formatFileSize(stats.value.totalSize) : "—",
    caption: "Total disk usage",
    icon: "i-lucide-hard-drive",
    color: "text-secondary bg-secondary-500/10",
  },
  {
    key: "libraries",
    title: "Libraries",
    value: stats.value?.libraries?.toLocaleString("en-US") ?? "—",
    caption: "Including personal defaults",
    icon: "i-lucide-library",
    color: "text-info bg-info-500/10",
  },
  {
    key: "users",
    title: "Users",
    value: stats.value?.users?.toLocaleString("en-US") ?? "—",
    caption: "Registered accounts",
    icon: "i-lucide-users",
    color: "text-success bg-success-500/10",
  },
  {
    key: "folders",
    title: "Folders",
    value: stats.value?.folders?.toLocaleString("en-US") ?? "—",
    caption: "Active folder hierarchy",
    icon: "i-lucide-folder-tree",
    color: "text-warning bg-warning-500/10",
  },
]);

const USelect = resolveComponent("USelect");

const roleOptions = [
  { label: "Owner", value: "owner" },
  { label: "Member", value: "member" },
];

const columns: TableColumn<AdminUser>[] = [
  {
    accessorKey: "displayName",
    header: "User",
    cell: ({ row }) =>
      h("div", { class: "flex items-center gap-3" }, [
        h(UserAvatar, {
          displayName: row.original.displayName,
          avatarUrl: row.original.avatarUrl,
          sizeClass: "w-8",
        }),
        h("div", { class: "min-w-0" }, [
          h("p", { class: "font-medium text-sm truncate" }, row.original.displayName),
          h("p", { class: "text-xs text-muted truncate" }, row.original.email),
        ]),
      ]),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) =>
      h(USelect, {
        modelValue: roleDrafts[row.original.id] ?? row.original.role,
        "onUpdate:modelValue": (v: AdminUser["role"]) => {
          roleDrafts[row.original.id] = v;
          updateUserRole(row.original, v);
        },
        items: roleOptions,
        size: "xs",
        disabled:
          updatingRoleUserId.value === row.original.id || currentUser.value?.id === row.original.id,
        class: "w-28",
      }),
  },
  {
    accessorKey: "createdAt",
    header: "Joined",
    cell: ({ row }) =>
      h("span", { class: "text-xs text-muted" }, formatDateTime(row.original.createdAt)),
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) =>
      h("span", { class: "text-xs text-muted" }, formatDateTime(row.original.updatedAt)),
  },
];
</script>

<template>
  <div class="flex flex-col gap-6 overflow-y-auto flex-1 min-h-0">
    <div>
      <h1 class="text-2xl font-bold">Admin Dashboard</h1>
      <p class="text-sm text-muted mt-0.5">
        Instance overview, user management, and background jobs.
      </p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <UCard v-for="s in statCards" :key="s.key" :ui="{ body: 'p-4' }">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs text-muted">{{ s.title }}</p>
            <p class="text-3xl font-semibold mt-1">{{ s.value }}</p>
            <p class="text-xs text-muted mt-1">{{ s.caption }}</p>
          </div>
          <div class="flex size-10 items-center justify-center rounded-lg" :class="s.color">
            <UIcon :name="s.icon" class="size-5" />
          </div>
        </div>
      </UCard>
    </div>

    <UCard :ui="{ body: 'p-0' }">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">Users</h2>
            <p class="text-sm text-muted">Manage accounts and roles.</p>
          </div>
          <UBadge v-if="users" color="neutral" variant="subtle">{{ users.length }}</UBadge>
        </div>
      </template>

      <div v-if="usersStatus === 'pending'" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>
      <UTable v-else-if="users?.length" :data="users" :columns="columns" class="max-h-[30rem]" />
      <p v-else class="px-6 pb-6 text-sm text-muted">No users found.</p>
    </UCard>

    <AdminJobsPanel embedded />
  </div>
</template>
