<script setup lang="ts">
definePageMeta({
  layout: "dashboard",
});

const { user, updateProfile } = useAuth();
const toast = useToast();
const colorMode = useColorMode();

const displayName = ref(user.value?.displayName ?? "");
const avatarUrl = ref(user.value?.avatarUrl ?? "");
const saving = ref(false);

watch(user, (u) => {
  if (u) {
    displayName.value = u.displayName;
    avatarUrl.value = u.avatarUrl ?? "";
  }
});

async function save() {
  saving.value = true;
  try {
    await updateProfile({
      displayName: displayName.value,
      avatarUrl: avatarUrl.value || undefined,
    });
    toast.add({ title: "Profile updated", color: "success" });
  } catch {
    toast.add({ title: "Failed to update profile", color: "error" });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg flex flex-col gap-6">
    <h1 class="text-xl font-semibold">My Profile</h1>

    <div class="flex flex-col gap-4">
      <UFormField label="Email">
        <UInput :model-value="user?.email" disabled class="w-full" />
      </UFormField>

      <UFormField label="Display Name">
        <UInput v-model="displayName" placeholder="Your display name" class="w-full" />
      </UFormField>

      <UFormField label="Avatar URL">
        <UInput v-model="avatarUrl" placeholder="https://example.com/avatar.jpg" class="w-full" />
      </UFormField>

      <div v-if="avatarUrl" class="flex items-center gap-3">
        <img
          :src="avatarUrl"
          alt="Avatar preview"
          class="size-12 rounded-full object-cover border border-default"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <span class="text-sm text-muted">Preview</span>
      </div>

      <UFormField label="Theme">
        <USelectMenu
          :model-value="colorMode.preference"
          :items="[
            { label: 'System', value: 'system' },
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]"
          value-key="value"
          class="w-full"
          @update:model-value="colorMode.preference = $event"
        />
      </UFormField>

      <div class="flex justify-end">
        <UButton label="Save" :loading="saving" @click="save" />
      </div>
    </div>
  </div>
</template>
