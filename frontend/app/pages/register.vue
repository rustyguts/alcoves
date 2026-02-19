<script setup lang="ts">
import * as z from "zod";
import { useRoute, useRouter } from "vue-router";
import AuthCardShell from "~/components/AuthCardShell.vue";
import OAuthGoogleButton from "~/components/OAuthGoogleButton.vue";
import { useAuth } from "~/composables/useAuth";
import { apiFetch } from "~/utils/api-fetch";

const { register } = useAuth();
const route = useRoute();
const router = useRouter();
const error = ref("");

// Fetch available SSO providers from backend
const providersLoading = ref(true);
const googleAuthEnabled = ref(false);

onMounted(async () => {
  try {
    const providers = await apiFetch<{ google: boolean }>("/api/auth/providers");
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
    : {
        path: "/login",
        query: { redirect: redirectPath.value },
      },
);

const name = ref("");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const fieldErrors = ref<Record<string, string>>({});

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

async function onSubmit() {
  error.value = "";
  fieldErrors.value = {};

  const result = schema.safeParse({
    name: name.value,
    email: email.value,
    password: password.value,
    confirmPassword: confirmPassword.value,
  });

  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (key && !fieldErrors.value[String(key)]) {
        fieldErrors.value[String(key)] = issue.message;
      }
    }
    return;
  }

  try {
    await register(result.data.name, result.data.email, result.data.password);
    router.push(redirectPath.value);
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message;
    error.value = msg || "Registration failed";
  }
}
</script>

<template>
  <AuthCardShell title="Create an account" subtitle="Get started with Alcoves." :error="error">
    <form @submit.prevent="onSubmit" class="space-y-4">
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Name</legend>
        <input
          v-model="name"
          type="text"
          placeholder="Enter your full name"
          required
          class="input w-full"
        />
        <p v-if="fieldErrors.name" class="text-error text-xs mt-1">{{ fieldErrors.name }}</p>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Email</legend>
        <input
          v-model="email"
          type="email"
          placeholder="Enter your email"
          required
          class="input w-full"
        />
        <p v-if="fieldErrors.email" class="text-error text-xs mt-1">{{ fieldErrors.email }}</p>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Password</legend>
        <input
          v-model="password"
          type="password"
          placeholder="Create a password"
          required
          class="input w-full"
        />
        <p v-if="fieldErrors.password" class="text-error text-xs mt-1">
          {{ fieldErrors.password }}
        </p>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend">Confirm Password</legend>
        <input
          v-model="confirmPassword"
          type="password"
          placeholder="Confirm your password"
          required
          class="input w-full"
        />
        <p v-if="fieldErrors.confirmPassword" class="text-error text-xs mt-1">
          {{ fieldErrors.confirmPassword }}
        </p>
      </fieldset>

      <button type="submit" class="btn btn-primary btn-block">Create account</button>
    </form>

    <div class="space-y-4">
      <Transition
        enter-active-class="transition-opacity duration-300"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
      >
        <div v-if="!providersLoading && googleAuthEnabled">
          <div class="divider">or</div>
          <OAuthGoogleButton />
        </div>
      </Transition>

      <div class="text-center text-sm">
        Already have an account?
        <RouterLink :to="loginLink" class="text-primary font-medium">Sign in</RouterLink>.
      </div>
    </div>
  </AuthCardShell>
</template>
