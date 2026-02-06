<script setup lang="ts">
import * as z from "zod";
import type { FormSubmitEvent, AuthFormField } from "@nuxt/ui";

definePageMeta({
  layout: false,
});

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

function onSubmit(payload: FormSubmitEvent<Schema>) {
  console.log("Registered", payload);
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
          description="Get started with Alcoves."
          icon="i-lucide-user-plus"
          :submit="{ label: 'Create account' }"
          @submit="onSubmit"
        >
          <template #footer>
            Already have an account?
            <ULink to="/login" class="text-primary font-medium">Sign in</ULink>.
          </template>
        </UAuthForm>
      </UPageCard>
    </div>
  </UApp>
</template>
