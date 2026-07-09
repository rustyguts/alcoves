<script lang="ts">
	import { onMount } from 'svelte';
	import { z } from 'zod';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/state/auth.svelte';
	import { api } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import { safeRedirect } from '$lib/utils/safe-redirect';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AuthCardShell from '$lib/components/ui/AuthCardShell.svelte';
	import OAuthGoogleButton from '$lib/components/ui/OAuthGoogleButton.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import type { RegistrationMode, InviteLookupResponse } from '$lib/types/api';

	let error = $state('');

	let providersLoading = $state(true);
	let googleAuthEnabled = $state(false);

	let registrationMode = $state<RegistrationMode | null>(null);
	let invite = $state<InviteLookupResponse | null>(null);
	let inviteError = $state<string | null>(null);
	let bootLoading = $state(true);

	const inviteToken = $derived.by(() => {
		const t = page.url.searchParams.get('invite');
		return t && t.length > 0 ? t : null;
	});

	const redirectPath = $derived(safeRedirect(page.url.searchParams.get('redirect')));

	const loginLink = $derived.by(() => {
		const query = new URLSearchParams();
		if (redirectPath !== '/') query.set('redirect', redirectPath);
		if (inviteToken) query.set('invite', inviteToken);
		const qs = query.toString();
		return qs ? `/login?${qs}` : '/login';
	});

	const canRegister = $derived.by(() => {
		if (registrationMode === null) return false;
		if (registrationMode === 'open') return true;
		if (registrationMode === 'closed') return false;
		// invite_only
		return !!invite && invite.canAccept;
	});

	const disabledMessage = $derived.by(() => {
		if (registrationMode === 'closed') {
			return 'Registration is disabled on this instance.';
		}
		if (registrationMode === 'invite_only') {
			if (!inviteToken) {
				return 'Registration is invite-only. You need an invite link to create an account.';
			}
			if (inviteError) return inviteError;
			if (invite && !invite.canAccept) {
				return `This invite is ${invite.status}.`;
			}
		}
		return null;
	});

	const schema = z
		.object({
			name: z.string().min(1, 'Name is required'),
			email: z.string().email('Invalid email'),
			password: z.string().min(8, 'Must be at least 8 characters'),
			confirmPassword: z.string()
		})
		.refine((data) => data.password === data.confirmPassword, {
			message: 'Passwords do not match',
			path: ['confirmPassword']
		});

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');

	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);

	onMount(async () => {
		try {
			const [providers, modeResp] = await Promise.all([
				api.auth.providers(),
				api.meta.registrationMode()
			]);
			googleAuthEnabled = providers.google;
			registrationMode = modeResp.mode;
		} catch (err) {
			console.error('Failed to load registration metadata:', err);
		} finally {
			providersLoading = false;
		}

		if (inviteToken) {
			try {
				invite = await api.invites.lookup(inviteToken);
				if (!invite.canAccept && invite.status !== 'already_member') {
					inviteError = `This invite is ${invite.status}.`;
				}
			} catch {
				inviteError = 'Invite not found.';
			}
		}
		bootLoading = false;
	});

	async function onSubmit() {
		error = '';
		fieldErrors = {};

		const result = schema.safeParse({ name, email, password, confirmPassword });
		if (!result.success) {
			for (const issue of result.error.issues) {
				const key = issue.path[0];
				if (typeof key === 'string' && !fieldErrors[key]) {
					fieldErrors[key] = issue.message;
				}
			}
			return;
		}

		submitting = true;
		try {
			await auth.register(name, email, password, inviteToken || undefined);
			// If they registered through an invite, send them to that library.
			if (invite?.library?.id) {
				await goto(`/libraries/${invite.library.id}`);
			} else {
				await goto(redirectPath);
			}
		} catch (err: unknown) {
			const msg = (err as { data?: { message?: string } })?.data?.message;
			error = msg || 'Registration failed';
		} finally {
			submitting = false;
		}
	}
</script>

<AuthCardShell title="Create an account" subtitle="Get started with Alcoves." {error}>
	{#if bootLoading}
		<div class="flex justify-center py-8">
			<AppIcon name={ICONS.loading} class="size-6 animate-spin text-muted-foreground" />
		</div>
	{:else if !canRegister}
		<Alert.Root>
			<AppIcon name={ICONS.lock} class="size-4 shrink-0 text-warning" />
			<Alert.Title>Registration disabled</Alert.Title>
			<Alert.Description>
				{disabledMessage || 'Registration is not available right now.'}
			</Alert.Description>
		</Alert.Root>
	{:else}
		<form
			class="flex flex-col gap-4"
			onsubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
		>
			{#if invite && invite.library}
				<Alert.Root>
					<AppIcon name={ICONS.email} class="size-4 shrink-0 text-primary" />
					<Alert.Title>You've been invited to {invite.library.name}</Alert.Title>
					<Alert.Description>
						Create an account below to accept the invite. Already have one?
						<a href={loginLink} class="font-medium text-primary hover:underline">
							Sign in instead
						</a>.
					</Alert.Description>
				</Alert.Root>
			{/if}

			<Field.Field data-invalid={!!fieldErrors.name}>
				<Label for="register-name">Name</Label>
				<Input
					id="register-name"
					type="text"
					placeholder="Your full name"
					autocomplete="name"
					aria-invalid={!!fieldErrors.name}
					bind:value={name}
				/>
				{#if fieldErrors.name}
					<Field.Error>{fieldErrors.name}</Field.Error>
				{/if}
			</Field.Field>

			<Field.Field data-invalid={!!fieldErrors.email}>
				<Label for="register-email">Email</Label>
				<Input
					id="register-email"
					type="email"
					placeholder="you@example.com"
					autocomplete="email"
					aria-invalid={!!fieldErrors.email}
					bind:value={email}
				/>
				{#if fieldErrors.email}
					<Field.Error>{fieldErrors.email}</Field.Error>
				{/if}
			</Field.Field>

			<Field.Field data-invalid={!!fieldErrors.password}>
				<Label for="register-password">Password</Label>
				<Input
					id="register-password"
					type="password"
					placeholder="At least 8 characters"
					autocomplete="new-password"
					aria-invalid={!!fieldErrors.password}
					bind:value={password}
				/>
				{#if fieldErrors.password}
					<Field.Error>{fieldErrors.password}</Field.Error>
				{/if}
			</Field.Field>

			<Field.Field data-invalid={!!fieldErrors.confirmPassword}>
				<Label for="register-confirm-password">Confirm password</Label>
				<Input
					id="register-confirm-password"
					type="password"
					placeholder="Re-enter password"
					autocomplete="new-password"
					aria-invalid={!!fieldErrors.confirmPassword}
					bind:value={confirmPassword}
				/>
				{#if fieldErrors.confirmPassword}
					<Field.Error>{fieldErrors.confirmPassword}</Field.Error>
				{/if}
			</Field.Field>

			<Button type="submit" size="lg" class="w-full" disabled={submitting}>
				{#if submitting}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{/if}
				Create account
			</Button>
		</form>
	{/if}

	{#snippet footer()}
		<div class="flex w-full flex-col gap-4">
			{#if canRegister && !providersLoading && googleAuthEnabled}
				<div class="flex flex-col gap-4">
					<div class="flex items-center gap-3 text-xs text-muted-foreground">
						<Separator.Root class="flex-1" />
						<span>or</span>
						<Separator.Root class="flex-1" />
					</div>
					<OAuthGoogleButton />
				</div>
			{/if}

			<p class="text-center text-sm text-muted-foreground">
				Already have an account?
				<a href={loginLink} class="font-medium text-primary hover:underline">Sign in</a>
			</p>
		</div>
	{/snippet}
</AuthCardShell>
