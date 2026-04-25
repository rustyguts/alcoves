<script setup lang="ts">
import * as z from "zod";
import AuthCardShell from "~/components/AuthCardShell.vue";

definePageMeta({ layout: false });
import OAuthGoogleButton from "~/components/OAuthGoogleButton.vue";
import { useAuth } from "~/composables/useAuth";
import { api } from "~/api";

const { register } = useAuth();
const route = useRoute();
const router = useRouter();
const error = ref("");

const providersLoading = ref(true);
const googleAuthEnabled = ref(false);

onMounted(async () => {
  try {
    const providers = await api.auth.providers();
    googleAuthEnabled.value = providers.google;
  } catch (err) {
    console.error("Failed to load auth providers:", err);
  } finally {
    providersLoading.value = false;
  }
});

const redirectPath = computed(() => {
  const raw = route.query.redirect;
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  return raw;
});
const loginLink = computed(() =>
  redirectPath.value === "/"
    ? "/login"
    : { path: "/login", query: { redirect: redirectPath.value } },
);

const schema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email"),
    password: z.string().min(8, "Must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

const state = reactive({
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
});

const submitting = ref(false);

async function onSubmit() {
  error.value = "";
  submitting.value = true;
  try {
    await register(state.name, state.email, state.password);
    router.push(redirectPath.value);
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message;
    error.value = msg || "Registration failed";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCardShell title="Create an account" subtitle="Get started with Alcoves." :error="error">
    <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
      <UFormField label="Name" name="name" required>
        <UInput
          v-model="state.name"
          placeholder="Your full name"
          icon="i-lucide-user"
          size="lg"
          class="w-full"
          :ui="{ root: 'w-full' }"
        />
      </UFormField>

      <UFormField label="Email" name="email" required>
        <UInput
          v-model="state.email"
          type="email"
          placeholder="you@example.com"
          icon="i-lucide-mail"
          size="lg"
          class="w-full"
          :ui="{ root: 'w-full' }"
        />
      </UFormField>

      <UFormField label="Password" name="password" required>
        <UInput
          v-model="state.password"
          type="password"
          placeholder="At least 8 characters"
          icon="i-lucide-lock"
          size="lg"
          class="w-full"
          :ui="{ root: 'w-full' }"
        />
      </UFormField>

      <UFormField label="Confirm password" name="confirmPassword" required>
        <UInput
          v-model="state.confirmPassword"
          type="password"
          placeholder="Re-enter password"
          icon="i-lucide-lock"
          size="lg"
          class="w-full"
          :ui="{ root: 'w-full' }"
        />
      </UFormField>

      <UButton
        type="submit"
        color="primary"
        size="lg"
        :loading="submitting"
        block
        class="justify-center"
      >
        Create account
      </UButton>
    </UForm>

    <template #footer>
      <div class="space-y-4 w-full">
        <Transition
          enter-active-class="transition-opacity duration-300"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
        >
          <div v-if="!providersLoading && googleAuthEnabled" class="space-y-4">
            <USeparator label="or" />
            <OAuthGoogleButton />
          </div>
        </Transition>

        <p class="text-center text-sm text-muted">
          Already have an account?
          <NuxtLink :to="loginLink" class="text-primary font-medium hover:underline">
            Sign in
          </NuxtLink>
        </p>
      </div>
    </template>
  </AuthCardShell>
</template>
