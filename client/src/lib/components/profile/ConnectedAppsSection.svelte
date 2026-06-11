<script lang="ts">
	import { onMount } from 'svelte';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { api, ApiError } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import type { OAuthConnection } from '$lib/types/api';

	/**
	 * Lists the apps a user has connected over OAuth (e.g. Claude's MCP custom
	 * connector) and lets them disconnect. Backed by
	 * api.oauth.connections/revokeConnection.
	 *
	 * The whole panel hides when the server has OAuth disabled — that route 404s,
	 * which we treat as "feature off" rather than an error.
	 */

	let connections = $state<OAuthConnection[]>([]);
	let available = $state(true);
	let loadError = $state(false);
	let revokingId = $state<string | null>(null);

	async function refresh() {
		try {
			const res = await api.oauth.connections();
			connections = res.connections;
			available = true;
			loadError = false;
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				// OAuth authorization server is disabled on this instance.
				available = false;
				return;
			}
			// Operational/transient error (incl. an expired-session 401): surface
			// it rather than silently rendering "0 connected" as authoritative.
			loadError = true;
		}
	}

	onMount(refresh);

	async function revoke(clientId: string) {
		revokingId = clientId;
		try {
			await api.oauth.revokeConnection(clientId);
			toast.add({ title: 'App disconnected', color: 'success' });
			await refresh();
		} catch {
			toast.add({ title: 'Failed to disconnect', color: 'error' });
		} finally {
			revokingId = null;
		}
	}

	function formatDate(value: string | null): string {
		if (!value) return 'never';
		return new Date(value).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}
</script>

{#if available}
	<AppPanel
		title="Connected apps"
		description="Apps you've authorized to access Alcoves over MCP. Each acts as you and can only do what you can."
		icon={ICONS.link}
	>
		{#snippet actions()}
			{#if !loadError}
				<span class="badge preset-tonal-surface">{connections.length} connected</span>
			{/if}
		{/snippet}

		{#if loadError}
			<div class="flex items-center gap-3 card preset-tonal-error p-4" role="alert">
				<AppIcon name={ICONS.error} class="size-5 shrink-0" />
				<div class="flex-1 space-y-0.5">
					<p class="text-sm font-medium">Couldn't load connected apps</p>
					<p class="text-xs opacity-80">Something went wrong. Try again in a moment.</p>
				</div>
				<Button variant="tonal" color="surface" size="sm" onclick={refresh}>Retry</Button>
			</div>
		{:else if connections.length}
			<div class="overflow-hidden rounded-md border border-surface-200-800">
				{#each connections as conn (conn.clientId)}
					<div
						class="flex flex-col gap-2 border-b border-surface-200-800 px-4 py-3 last:border-b-0 md:flex-row md:items-center"
					>
						<div class="flex min-w-0 flex-1 items-center gap-3">
							<div
								class="flex size-9 shrink-0 items-center justify-center rounded-full preset-tonal-surface"
							>
								<AppIcon name={ICONS.link} class="size-4" />
							</div>
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{conn.clientName}</p>
								<div
									class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-surface-600-400"
								>
									<span>Connected {formatDate(conn.createdAt)}</span>
									<span aria-hidden="true">·</span>
									<span>
										{conn.lastUsedAt ? `Last used ${formatDate(conn.lastUsedAt)}` : 'Never used'}
									</span>
								</div>
							</div>
						</div>
						<Button
							variant="tonal"
							color="error"
							size="sm"
							loading={revokingId === conn.clientId}
							disabled={revokingId === conn.clientId}
							onclick={() => revoke(conn.clientId)}
						>
							{#snippet icon()}
								<AppIcon name={ICONS.trash} class="size-4" />
							{/snippet}
							Disconnect
						</Button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex items-start gap-3 card preset-tonal-surface p-4">
				<AppIcon name={ICONS.link} class="size-5 shrink-0 opacity-70" />
				<div class="space-y-0.5">
					<p class="text-sm font-medium">No connected apps</p>
					<p class="text-xs text-surface-600-400">
						Add Alcoves as a custom connector in an MCP client (like Claude) to connect one.
					</p>
				</div>
			</div>
		{/if}
	</AppPanel>
{/if}
