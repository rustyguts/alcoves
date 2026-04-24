<script setup lang="ts">
import * as z from "zod";
import { useRoute, useRouter } from "vue-router";
import AuthCardShell from "~/components/AuthCardShell.vue";
import OAuthGoogleButton from "~/components/OAuthGoogleButton.vue";
import { useAuth } from "~/composables/useAuth";
import { api } from "~/api";

const { login } = useAuth();
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
const registerLink = computed(() =>
  redirectPath.value === "/"
    ? "/register"
    : { path: "/register", query: { redirect: redirectPath.value } },
);

if (route.query.error === "google") {
  error.value = "Google sign-in failed. Please try again.";
}

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Must be at least 8 characters"),
});

const state = reactive({
  email: "",
  password: "",
});

const submitting = ref(false);

async function onSubmit() {
  error.value = "";
  submitting.value = true;
  try {
    await login(state.email, state.password);
    router.push(redirectPath.value);
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message;
    error.value = msg || "Invalid email or password";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCardShell
    title="Welcome back"
    subtitle="Sign in to your account to continue."
    :error="error"
  >
    <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
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
          placeholder="••••••••"
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
        Sign in
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
          Don't have an account?
          <RouterLink :to="registerLink" class="text-primary font-medium hover:underline">
            Sign up
          </RouterLink>
        </p>
      </div>
    </template>
  </AuthCardShell>
</template>
