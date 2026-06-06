<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { env } from '$env/dynamic/public';
	import { auth } from '$lib/state/auth.svelte';
	import { ApiError } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import { safeRedirect } from '$lib/utils/safe-redirect';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AuthCardShell from '$lib/components/ui/AuthCardShell.svelte';
	import OAuthGoogleButton from '$lib/components/ui/OAuthGoogleButton.svelte';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let submitting = $state(false);

	const googleAuthEnabled = env.PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

	// Where to land after a successful sign-in. safeRedirect() honors only same-site
	// absolute paths (rejects //host, /\host, and absolute URLs) so a crafted
	// ?redirect= can't bounce the user off-site.
	const redirectPath = $derived(safeRedirect(page.url.searchParams.get('redirect')));

	const registerLink = $derived(
		redirectPath === '/' ? '/register' : `/register?redirect=${encodeURIComponent(redirectPath)}`
	);

	// Surface a failed Google round-trip (`?error=google`) once on load.
	$effect(() => {
		if (page.url.searchParams.get('error') === 'google') {
			error = 'Google sign-in failed. Please try again.';
		}
	});

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		submitting = true;
		try {
			await auth.login(email, password);
			await goto(redirectPath);
		} catch (err) {
			const serverMsg =
				err instanceof ApiError && typeof err.data?.message === 'string' ? err.data.message : '';
			error = serverMsg || 'Invalid email or password';
		} finally {
			submitting = false;
		}
	}
</script>

<AuthCardShell title="Welcome back" subtitle="Sign in to your account to continue." {error}>
	<form class="space-y-4" onsubmit={onSubmit}>
		<label class="label">
			<span class="label-text">Email</span>
			<div class="input-group grid grid-cols-[auto_1fr] rounded-lg preset-filled-surface-100-900">
				<span class="flex items-center justify-center pl-3 opacity-60">
					<AppIcon name={ICONS.email} class="size-4" />
				</span>
				<input
					class="bg-transparent px-2 py-2 outline-none"
					type="email"
					bind:value={email}
					placeholder="you@example.com"
					aria-label="Email"
					autocomplete="email"
					required
				/>
			</div>
		</label>

		<label class="label">
			<span class="label-text">Password</span>
			<div class="input-group grid grid-cols-[auto_1fr] rounded-lg preset-filled-surface-100-900">
				<span class="flex items-center justify-center pl-3 opacity-60">
					<AppIcon name={ICONS.lock} class="size-4" />
				</span>
				<input
					class="bg-transparent px-2 py-2 outline-none"
					type="password"
					bind:value={password}
					placeholder="••••••••"
					aria-label="Password"
					autocomplete="current-password"
					required
				/>
			</div>
		</label>

		<button
			type="submit"
			class="btn w-full justify-center preset-filled-primary-500 btn-lg"
			disabled={submitting}
		>
			{#if submitting}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{/if}
			Sign in
		</button>
	</form>

	{#snippet footer()}
		<div class="w-full space-y-4">
			{#if googleAuthEnabled}
				<div class="space-y-4">
					<div class="flex items-center gap-3 text-sm opacity-60">
						<hr class="flex-1 border-surface-200-800" />
						<span>or</span>
						<hr class="flex-1 border-surface-200-800" />
					</div>
					<OAuthGoogleButton />
				</div>
			{/if}

			<p class="text-center text-sm opacity-75">
				Don't have an account?
				<a href={registerLink} class="font-medium text-primary-500 hover:underline">Sign up</a>
			</p>
		</div>
	{/snippet}
</AuthCardShell>
