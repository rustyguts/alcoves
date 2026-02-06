<script setup lang="ts">
import * as z from "zod";
import type { FormSubmitEvent, AuthFormField } from "@nuxt/ui";

definePageMeta({
  layout: false,
});

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
  {
    name: "remember",
    label: "Remember me",
    type: "checkbox",
  },
];

const schema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Must be at least 8 characters"),
});

type Schema = z.output<typeof schema>;

function onSubmit(payload: FormSubmitEvent<Schema>) {
  console.log("Submitted", payload);
}
</script>

<template>
  <UApp>
    <div class="flex min-h-svh items-center justify-center bg-default p-4">
      <UPageCard class="w-full max-w-md">
        <UAuthForm :schema="schema" :fields="fields" title="Welcome back"
          description="Sign in to your account to continue." icon="i-lucide-lock" @submit="onSubmit">
          <template #password-hint>
            <ULink to="#" class="text-primary font-medium" tabindex="-1"> Forgot password? </ULink>
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
