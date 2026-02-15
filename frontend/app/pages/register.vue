<script setup lang="ts">
import * as z from "zod";
import { useRoute, useRouter } from "vue-router";
import { useAuth } from "~/composables/useAuth";
import AppIcon from "~/components/AppIcon.vue";

const { register } = useAuth();
const route = useRoute();
const router = useRouter();
const error = ref("");
const googleAuthEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";
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
  <div class="flex min-h-svh items-center justify-center p-4">
    <div class="card bg-base-100 shadow-xl w-full max-w-md">
      <div class="card-body">
        <div class="flex flex-col items-center gap-2 mb-4">
          <AppIcon name="i-lucide-user-plus" class="text-3xl" />
          <h2 class="card-title text-2xl">Create an account</h2>
          <p class="text-sm text-base-content/60">Get started with Alcoves.</p>
          <p v-if="error" class="text-sm text-error mt-1">{{ error }}</p>
        </div>

        <form @submit.prevent="onSubmit" class="space-y-4">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Name</legend>
            <input
              v-model="name"
              type="text"
              placeholder="Enter your full name"
              required
              class="input input-bordered w-full"
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
              class="input input-bordered w-full"
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
              class="input input-bordered w-full"
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
              class="input input-bordered w-full"
            />
            <p v-if="fieldErrors.confirmPassword" class="text-error text-xs mt-1">
              {{ fieldErrors.confirmPassword }}
            </p>
          </fieldset>

          <button type="submit" class="btn btn-primary btn-block">Create account</button>
        </form>

        <div class="space-y-4 mt-4">
          <template v-if="googleAuthEnabled">
            <div class="divider">or</div>
            <a href="/api/auth/google" class="btn btn-outline btn-neutral btn-block">
              <svg class="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </a>
          </template>
          <div class="text-center text-sm">
            Already have an account?
            <RouterLink :to="loginLink" class="text-primary font-medium">Sign in</RouterLink>.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
