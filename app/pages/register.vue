<script setup lang="ts">
import * as z from "zod";
import type { FormSubmitEvent, AuthFormField } from "@nuxt/ui";

definePageMeta({
  layout: false,
});

const { register } = useAuth();
const error = ref("");

const fields: AuthFormField[] = [
  {
    name: "name",
    type: "text",
    label: "Name",
    placeholder: "Enter your full name",
    required: true,
  },
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
    placeholder: "Create a password",
    required: true,
  },
  {
    name: "confirmPassword",
    label: "Confirm Password",
    type: "password",
    placeholder: "Confirm your password",
    required: true,
  },
];

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

type Schema = z.output<typeof schema>;

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  error.value = "";
  try {
    await register(payload.data.name, payload.data.email, payload.data.password);
    await navigateTo("/");
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message;
    error.value = msg || "Registration failed";
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
          title="Create an account"
          icon="i-lucide-user-plus"
          :submit="{ label: 'Create account' }"
          @submit="onSubmit"
        >
          <template #description>
            <p class="text-sm text-muted">Get started with Alcoves.</p>
            <p v-if="error" class="text-sm text-error mt-2">{{ error }}</p>
          </template>
          <template #footer>
            Already have an account?
            <ULink to="/login" class="text-primary font-medium">Sign in</ULink>.
          </template>
        </UAuthForm>
      </UPageCard>
    </div>
  </UApp>
</template>
