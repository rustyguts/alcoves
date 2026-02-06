<script setup lang="ts">
import * as z from "zod";
import type { FormSubmitEvent, AuthFormField } from "@nuxt/ui";

definePageMeta({
  layout: false,
});

const { login } = useAuth();
const route = useRoute();
const config = useRuntimeConfig();
const error = ref("");
const googleAuthEnabled = config.public.googleAuthEnabled;

if (route.query.error === "google") {
  error.value = "Google sign-in failed. Please try again.";
}

const fields: AuthFormField[] = [
  {
    name: "email",
    type: "email",
    label: "Email",
    placeholder: "Enter your email",
    required: true,
  },
  {
    name: "password",
    label: "Password",
    type: "password",
    placeholder: "Enter your password",
    required: true,
  },
];

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Must be at least 8 characters"),
});

type Schema = z.output<typeof schema>;

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  error.value = "";
  try {
    await login(payload.data.email, payload.data.password);
    await navigateTo("/");
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message;
    error.value = msg || "Invalid email or password";
  }
}
</script>

<template>
  <UApp>
    <div class="flex min-h-svh items-center justify-center bg-default p-4">
      <UPageCard class="w-full max-w-md">
        <UAuthForm
          :schema="schema"
          :fields="fields"
          title="Welcome back"
          description="Sign in to your account to continue."
          icon="i-lucide-lock"
          @submit="onSubmit"
        >
          <template #description>
            <p class="text-sm text-muted">Sign in to your account to continue.</p>
            <p v-if="error" class="text-sm text-error mt-2">{{ error }}</p>
          </template>
          <template #footer>
            <div class="space-y-4">
              <template v-if="googleAuthEnabled">
                <USeparator label="or" />
                <UButton color="neutral" variant="outline" block to="/api/auth/google" external>
                  <template #leading>
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
                  </template>
                  Continue with Google
                </UButton>
              </template>
              <div class="text-center text-sm">
                Don't have an account?
                <ULink to="/register" class="text-primary font-medium">Sign up</ULink>.
              </div>
            </div>
          </template>
        </UAuthForm>
      </UPageCard>
    </div>
  </UApp>
</template>
