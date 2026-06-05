<script setup lang="ts">
import * as z from "zod";
import AuthCardShell from "~/components/AuthCardShell.vue";

definePageMeta({ layout: false });
import OAuthGoogleButton from "~/components/OAuthGoogleButton.vue";
import { useAuth } from "~/composables/useAuth";
import { api } from "~/api";
import type { InviteLookupResponse } from "~~/shared/types/api";

const { login } = useAuth();
const route = useRoute();
const router = useRouter();
const error = ref("");

const providersLoading = ref(true);
const googleAuthEnabled = ref(false);

const inviteToken = computed(() => {
  const t = route.query.invite;
  return typeof t === "string" && t.length > 0 ? t : null;
});
const invite = ref<InviteLookupResponse | null>(null);

onMounted(async () => {
  try {
    const providers = await api.auth.providers();
    googleAuthEnabled.value = providers.google;
  } catch (err) {
    console.error("Failed to load auth providers:", err);
  } finally {
    providersLoading.value = false;
  }

  if (inviteToken.value) {
    try {
      invite.value = await api.invites.lookup(inviteToken.value);
    } catch {
      invite.value = null;
    }
  }
});

const redirectPath = computed(() => {
  const raw = route.query.redirect;
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  return raw;
});
const registerLink = computed(() => {
  const query: Record<string, string> = {};
  if (redirectPath.value !== "/") query.redirect = redirectPath.value;
  if (inviteToken.value) query.invite = inviteToken.value;
  return Object.keys(query).length === 0 ? "/register" : { path: "/register", query };
});

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

    // If user arrived with an invite token, redeem it before navigating.
    if (inviteToken.value) {
      try {
        const result = await api.invites.accept(inviteToken.value);
        router.push(`/libraries/${result.libraryId}`);
        return;
      } catch {
        // Fall through to redirect; invite landing will surface the failure.
        router.push(`/invites/${inviteToken.value}`);
        return;
      }
    }

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
      <UAlert
        v-if="invite && invite.library"
        color="info"
        variant="subtle"
        icon="i-lineicons-envelope"
        :title="`You've been invited to ${invite.library.name}`"
        description="Sign in to accept the invite. New here? Create an account below."
      />

      <UFormField label="Email" name="email" required>
        <UInput
          v-model="state.email"
          type="email"
          placeholder="you@example.com"
          icon="i-lineicons-envelope"
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
          icon="i-lineicons-lock"
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
          {{ invite ? "New here?" : "Don't have an account?" }}
          <NuxtLink :to="registerLink" class="text-primary font-medium hover:underline">
            {{ invite ? "Create an account" : "Sign up" }}
          </NuxtLink>
        </p>
      </div>
    </template>
  </AuthCardShell>
</template>
