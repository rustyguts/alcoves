<script setup lang="ts">
import * as z from "zod";
import type { FormSubmitEvent, AuthFormField } from "@nuxt/ui";

definePageMeta({
  layout: false,
});

const { login } = useAuth();
const route = useRoute();
const error = ref("");

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
          <template #header>
            <UButton
              label="Continue with Google"
              icon="i-lucide-chrome"
              color="neutral"
              variant="outline"
              block
              to="/api/auth/google"
              external
            />
            <USeparator label="or" />
          </template>
          <template #footer>
            Don't have an account?
            <ULink to="/register" class="text-primary font-medium">Sign up</ULink>.
          </template>
        </UAuthForm>
      </UPageCard>
    </div>
  </UApp>
</template>
