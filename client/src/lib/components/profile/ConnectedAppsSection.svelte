<script lang="ts">
	import { onMount } from 'svelte';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
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

	function scopesOf(scope: string): string[] {
		return scope.split(/\s+/).filter(Boolean);
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
				<Badge variant="secondary">{connections.length} connected</Badge>
			{/if}
		{/snippet}

		{#if loadError}
			<Alert.Root variant="destructive">
				<AppIcon name={ICONS.error} class="size-4 shrink-0" />
				<Alert.Title>Couldn't load connected apps</Alert.Title>
				<Alert.Description>Something went wrong. Try again in a moment.</Alert.Description>
				<Alert.Action>
					<Button variant="ghost" size="sm" onclick={refresh}>Retry</Button>
				</Alert.Action>
			</Alert.Root>
		{:else if connections.length}
			<Item.Group>
				{#each connections as conn (conn.clientId)}
					<Item.Root variant="outline">
						<Item.Media variant="icon" class="size-9 rounded-full bg-muted text-muted-foreground">
							<AppIcon name={ICONS.link} class="size-4" />
						</Item.Media>
						<Item.Content>
							<Item.Title>{conn.clientName}</Item.Title>
							<Item.Description>
								Connected {formatDate(conn.createdAt)} · {conn.lastUsedAt
									? `Last used ${formatDate(conn.lastUsedAt)}`
									: 'Never used'}
							</Item.Description>
							{#if scopesOf(conn.scope).length}
								<div class="mt-1 flex flex-wrap gap-1">
									{#each scopesOf(conn.scope) as scope (scope)}
										<Badge variant="outline">{scope}</Badge>
									{/each}
								</div>
							{/if}
						</Item.Content>
						<Item.Actions>
							<Button
								variant="ghost"
								size="sm"
								disabled={revokingId === conn.clientId}
								onclick={() => revoke(conn.clientId)}
							>
								{#if revokingId === conn.clientId}
									<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
								{:else}
									<AppIcon name={ICONS.trash} class="size-4" />
								{/if}
								Disconnect
							</Button>
						</Item.Actions>
					</Item.Root>
				{/each}
			</Item.Group>
		{:else}
			<div class="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
				<AppIcon name={ICONS.link} class="size-5 shrink-0 opacity-70" />
				<div class="space-y-0.5">
					<p class="text-sm font-medium">No connected apps</p>
					<p class="text-xs text-muted-foreground">
						Add Alcoves as a custom connector in an MCP client (like Claude) to connect one.
					</p>
				</div>
			</div>
		{/if}
	</AppPanel>
{/if}
