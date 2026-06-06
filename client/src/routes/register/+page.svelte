<script lang="ts">
	import { onMount } from 'svelte';
	import { z } from 'zod';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/state/auth.svelte';
	import { api } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AuthCardShell from '$lib/components/ui/AuthCardShell.svelte';
	import OAuthGoogleButton from '$lib/components/ui/OAuthGoogleButton.svelte';
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

	const redirectPath = $derived.by(() => {
		const raw = page.url.searchParams.get('redirect');
		if (!raw || !raw.startsWith('/')) return '/';
		return raw;
	});

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
			<AppIcon name={ICONS.loading} class="size-6 animate-spin opacity-60" />
		</div>
	{:else if !canRegister}
		<div class="space-y-3 py-2">
			<div class="flex items-start gap-2 card preset-tonal-warning p-3 text-sm" role="alert">
				<AppIcon name={ICONS.lock} class="mt-0.5 size-4 shrink-0" />
				<div>
					<p class="font-medium">Registration disabled</p>
					<p class="opacity-80">
						{disabledMessage || 'Registration is not available right now.'}
					</p>
				</div>
			</div>
		</div>
	{:else}
		<form
			class="space-y-4"
			onsubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
		>
			{#if invite && invite.library}
				<div class="flex items-start gap-2 card preset-tonal-secondary p-3 text-sm" role="status">
					<AppIcon name={ICONS.email} class="mt-0.5 size-4 shrink-0" />
					<div>
						<p class="font-medium">You've been invited to {invite.library.name}</p>
						<p class="opacity-80">
							Create an account below to accept the invite. Already have one?
							<a href={loginLink} class="font-medium text-primary-500 hover:underline">
								Sign in instead
							</a>.
						</p>
					</div>
				</div>
			{/if}

			<label class="label">
				<span class="label-text">Name</span>
				<input
					class="input w-full"
					type="text"
					placeholder="Your full name"
					autocomplete="name"
					bind:value={name}
				/>
				{#if fieldErrors.name}
					<span class="text-xs text-error-500">{fieldErrors.name}</span>
				{/if}
			</label>

			<label class="label">
				<span class="label-text">Email</span>
				<input
					class="input w-full"
					type="email"
					placeholder="you@example.com"
					autocomplete="email"
					bind:value={email}
				/>
				{#if fieldErrors.email}
					<span class="text-xs text-error-500">{fieldErrors.email}</span>
				{/if}
			</label>

			<label class="label">
				<span class="label-text">Password</span>
				<input
					class="input w-full"
					type="password"
					placeholder="At least 8 characters"
					autocomplete="new-password"
					bind:value={password}
				/>
				{#if fieldErrors.password}
					<span class="text-xs text-error-500">{fieldErrors.password}</span>
				{/if}
			</label>

			<label class="label">
				<span class="label-text">Confirm password</span>
				<input
					class="input w-full"
					type="password"
					placeholder="Re-enter password"
					autocomplete="new-password"
					bind:value={confirmPassword}
				/>
				{#if fieldErrors.confirmPassword}
					<span class="text-xs text-error-500">{fieldErrors.confirmPassword}</span>
				{/if}
			</label>

			<button
				type="submit"
				class="btn w-full justify-center preset-filled-primary-500 btn-lg"
				disabled={submitting}
			>
				{#if submitting}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{/if}
				Create account
			</button>
		</form>
	{/if}

	{#snippet footer()}
		<div class="w-full space-y-4">
			{#if canRegister && !providersLoading && googleAuthEnabled}
				<div class="space-y-4">
					<div class="flex items-center gap-3 text-xs opacity-60">
						<hr class="flex-1 border-surface-200-800" />
						<span>or</span>
						<hr class="flex-1 border-surface-200-800" />
					</div>
					<OAuthGoogleButton />
				</div>
			{/if}

			<p class="text-center text-sm opacity-75">
				Already have an account?
				<a href={loginLink} class="font-medium text-primary-500 hover:underline">Sign in</a>
			</p>
		</div>
	{/snippet}
</AuthCardShell>
