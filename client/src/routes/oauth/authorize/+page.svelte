<script lang="ts">
	import { api, ApiError } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AuthCardShell from '$lib/components/ui/AuthCardShell.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let submitting = $state(false);
	let errorMsg = $state('');

	// Human-readable copy for each granted scope.
	const scopeLabels: Record<string, string> = {
		mcp: 'Read, organize, and manage your libraries through MCP — acting as you'
	};

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
		<div class="space-y-5">
			<div class="flex items-start gap-3 card preset-tonal-surface p-4">
				<AppIcon name={ICONS.shield} class="size-5 shrink-0 opacity-80" />
				<div class="space-y-1.5 text-sm">
					<p class="font-medium">This will allow {data.info.client.clientName} to:</p>
					<ul class="space-y-1">
						{#each data.info.scopes as scope (scope)}
							<li class="flex items-start gap-2 text-surface-700-300">
								<AppIcon name={ICONS.check} class="mt-0.5 size-4 shrink-0 opacity-70" />
								<span>{scopeLabels[scope] ?? scope}</span>
							</li>
						{/each}
					</ul>
				</div>
			</div>

			<p class="text-xs text-surface-600-400">
				Signed in as <span class="font-medium">{data.userName}</span>. Only approve apps you trust —
				this connection can do anything you can in your libraries. You can revoke it any time from
				your profile.
			</p>

			{#if errorMsg}
				<div class="flex items-center gap-2 card preset-tonal-error p-3 text-sm" role="alert">
					<AppIcon name={ICONS.error} class="size-4 shrink-0" />
					<span>{errorMsg}</span>
				</div>
			{/if}

			<div class="flex gap-2">
				<Button
					variant="tonal"
					color="surface"
					class="flex-1"
					disabled={submitting}
					onclick={() => decide(false)}
				>
					Deny
				</Button>
				<Button
					class="flex-1"
					loading={submitting}
					disabled={submitting}
					onclick={() => decide(true)}
				>
					{#snippet icon()}
						<AppIcon name={ICONS.check} class="size-4" />
					{/snippet}
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
			<a class="anchor text-sm" href="/">Return to Alcoves</a>
		</div>
	</AuthCardShell>
{/if}
