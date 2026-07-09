<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AuthCardShell from '$lib/components/ui/AuthCardShell.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let submitting = $state(false);
	let errorMsg = $state('');

	// Human-readable copy for each granted scope.
	const scopeLabels: Record<string, string> = {
		mcp: 'Read, organize, and manage your libraries through MCP — acting as you'
	};

	// The real trust anchor: where the client will send the authorization code.
	// (client_name comes from unauthenticated registration and can be spoofed.)
	const redirectHost = $derived.by(() => {
		if (!data.ok) return '';
		try {
			return new URL(data.info.request.redirectUri).host;
		} catch {
			return data.info.request.redirectUri;
		}
	});

	async function decide(approve: boolean) {
		if (!data.ok) return;
		submitting = true;
		errorMsg = '';
		try {
			const { redirect } = await api.oauth.decision({
				consentToken: data.info.consentToken,
				approve,
				...data.info.request
			});
			// Hand control back to the OAuth client (or its error redirect).
			window.location.href = redirect;
		} catch (err) {
			errorMsg =
				err instanceof ApiError && typeof err.data?.error_description === 'string'
					? err.data.error_description
					: 'Something went wrong. Please try again.';
			submitting = false;
		}
	}
</script>

{#if data.ok}
	<AuthCardShell
		title="Connect to Alcoves"
		subtitle="{data.info.client.clientName} wants to connect to your account."
	>
		<div class="flex flex-col gap-5">
			<div class="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
				<AppIcon name={ICONS.shield} class="size-5 shrink-0 text-muted-foreground" />
				<div class="flex flex-col gap-1.5 text-sm">
					<p class="font-medium">This will allow {data.info.client.clientName} to:</p>
					<ul class="flex flex-col gap-1">
						{#each data.info.scopes as scope, i (i)}
							<li class="flex items-start gap-2 text-muted-foreground">
								<AppIcon name={ICONS.check} class="mt-0.5 size-4 shrink-0 text-success" />
								<span>{scopeLabels[scope] ?? scope}</span>
							</li>
						{/each}
					</ul>
				</div>
			</div>

			<p class="text-xs text-muted-foreground">
				After you approve, you'll be sent to
				<span class="font-medium break-all text-foreground">{redirectHost}</span>. Make sure you
				recognize it.
			</p>

			<p class="text-xs text-muted-foreground">
				Signed in as <span class="font-medium text-foreground">{data.userName}</span>. Only approve
				apps you trust — this connection can do anything you can in your libraries. You can revoke
				it any time from your profile.
			</p>

			{#if errorMsg}
				<Alert.Root variant="destructive">
					<AppIcon name={ICONS.error} class="size-4 shrink-0" />
					<Alert.Description>{errorMsg}</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="flex gap-2">
				<Button
					variant="outline"
					class="flex-1"
					disabled={submitting}
					onclick={() => decide(false)}
				>
					Deny
				</Button>
				<Button class="flex-1" disabled={submitting} onclick={() => decide(true)}>
					{#if submitting}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.check} class="size-4" />
					{/if}
					Approve
				</Button>
			</div>
		</div>
	</AuthCardShell>
{:else}
	<AuthCardShell
		title="Authorization failed"
		subtitle="We couldn't process this request."
		error={data.error}
	>
		<div class="flex justify-center">
			<a class="text-sm text-primary hover:underline" href="/">Return to Alcoves</a>
		</div>
	</AuthCardShell>
{/if}
