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
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';

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
	<form class="flex flex-col gap-4" onsubmit={onSubmit}>
		<Field.Field>
			<Label for="login-email">Email</Label>
			<InputGroup.Root>
				<InputGroup.Addon>
					<AppIcon name={ICONS.email} class="size-4" />
				</InputGroup.Addon>
				<InputGroup.Input
					id="login-email"
					type="email"
					bind:value={email}
					placeholder="you@example.com"
					autocomplete="email"
					required
				/>
			</InputGroup.Root>
		</Field.Field>

		<Field.Field>
			<Label for="login-password">Password</Label>
			<InputGroup.Root>
				<InputGroup.Addon>
					<AppIcon name={ICONS.lock} class="size-4" />
				</InputGroup.Addon>
				<InputGroup.Input
					id="login-password"
					type="password"
					bind:value={password}
					placeholder="••••••••"
					autocomplete="current-password"
					required
				/>
			</InputGroup.Root>
		</Field.Field>

		<Button type="submit" size="lg" class="w-full" disabled={submitting}>
			{#if submitting}
				<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
			{/if}
			Sign in
		</Button>
	</form>

	{#snippet footer()}
		<div class="flex w-full flex-col gap-4">
			{#if googleAuthEnabled}
				<div class="flex flex-col gap-4">
					<div class="flex items-center gap-3 text-sm text-muted-foreground">
						<Separator.Root class="flex-1" />
						<span>or</span>
						<Separator.Root class="flex-1" />
					</div>
					<OAuthGoogleButton />
				</div>
			{/if}

			<p class="text-center text-sm text-muted-foreground">
				Don't have an account?
				<a href={registerLink} class="font-medium text-primary hover:underline">Sign up</a>
			</p>
		</div>
	{/snippet}
</AuthCardShell>
