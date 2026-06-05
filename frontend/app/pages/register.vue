<script setup lang="ts">
import * as z from "zod";
import AuthCardShell from "~/components/AuthCardShell.vue";

definePageMeta({ layout: false });
import OAuthGoogleButton from "~/components/OAuthGoogleButton.vue";
import { useAuth } from "~/composables/useAuth";
import { api } from "~/api";
import type { RegistrationMode, InviteLookupResponse } from "~~/shared/types/api";

const { register } = useAuth();
const route = useRoute();
const router = useRouter();
const error = ref("");

const providersLoading = ref(true);
const googleAuthEnabled = ref(false);

const registrationMode = ref<RegistrationMode | null>(null);
const inviteToken = computed(() => {
  const t = route.query.invite;
  return typeof t === "string" && t.length > 0 ? t : null;
});
const invite = ref<InviteLookupResponse | null>(null);
const inviteError = ref<string | null>(null);
const bootLoading = ref(true);

onMounted(async () => {
  try {
    const [providers, modeResp] = await Promise.all([
      api.auth.providers(),
      api.meta.registrationMode(),
    ]);
    googleAuthEnabled.value = providers.google;
    registrationMode.value = modeResp.mode;
  } catch (err) {
    console.error("Failed to load registration metadata:", err);
  } finally {
    providersLoading.value = false;
  }

  if (inviteToken.value) {
    try {
      invite.value = await api.invites.lookup(inviteToken.value);
      if (!invite.value.canAccept && invite.value.status !== "already_member") {
        inviteError.value = `This invite is ${invite.value.status}.`;
      }
    } catch {
      inviteError.value = "Invite not found.";
    }
  }
  bootLoading.value = false;
});

const redirectPath = computed(() => {
  const raw = route.query.redirect;
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  return raw;
});
const loginLink = computed(() => {
  const query: Record<string, string> = {};
  if (redirectPath.value !== "/") query.redirect = redirectPath.value;
  if (inviteToken.value) query.invite = inviteToken.value;
  return Object.keys(query).length === 0 ? "/login" : { path: "/login", query };
});

const canRegister = computed(() => {
  if (registrationMode.value === null) return false;
  if (registrationMode.value === "open") return true;
  if (registrationMode.value === "closed") return false;
  // invite_only
  return !!invite.value && invite.value.canAccept;
});

const disabledMessage = computed(() => {
  if (registrationMode.value === "closed") {
    return "Registration is disabled on this instance.";
  }
  if (registrationMode.value === "invite_only") {
    if (!inviteToken.value) {
      return "Registration is invite-only. You need an invite link to create an account.";
    }
    if (inviteError.value) return inviteError.value;
    if (invite.value && !invite.value.canAccept) {
      return `This invite is ${invite.value.status}.`;
    }
  }
  return null;
});

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
    await register(state.name, state.email, state.password, inviteToken.value || undefined);
    // If they registered through an invite, send them to that library.
    if (invite.value?.library?.id) {
      router.push(`/libraries/${invite.value.library.id}`);
    } else {
      router.push(redirectPath.value);
    }
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
    <div v-if="bootLoading" class="flex justify-center py-8">
      <UIcon name="i-lineicons-spinner-solid" class="size-6 animate-spin text-muted" />
    </div>

    <div v-else-if="!canRegister" class="space-y-3 py-2">
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lineicons-lock"
        title="Registration disabled"
        :description="disabledMessage || 'Registration is not available right now.'"
      />
    </div>

    <UForm v-else :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
      <UAlert
        v-if="invite && invite.library"
        color="info"
        variant="subtle"
        icon="i-lineicons-envelope"
        :title="`You've been invited to ${invite.library.name}`"
      >
        <template #description>
          Create an account below to accept the invite. Already have one?
          <NuxtLink :to="loginLink" class="text-primary font-medium hover:underline">
            Sign in instead
          </NuxtLink>
          .
        </template>
      </UAlert>

      <UFormField label="Name" name="name" required>
        <UInput
          v-model="state.name"
          placeholder="Your full name"
          icon="i-lineicons-user"
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
          placeholder="At least 8 characters"
          icon="i-lineicons-lock"
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
          <div v-if="canRegister && !providersLoading && googleAuthEnabled" class="space-y-4">
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
