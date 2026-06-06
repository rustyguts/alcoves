<script lang="ts">
	import { onMount } from 'svelte';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import AppModal from '$lib/components/ui/AppModal.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';
	import { api } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import type { AccessToken, CreatedAccessToken } from '$lib/types/api';

	/**
	 * MCP access-token management. Lists the user's tokens, lets them mint a new one
	 * (the plaintext is shown exactly once in a modal right after creation), and
	 * revoke existing tokens. Backed by api.auth.listTokens/createToken/revokeToken.
	 */

	let tokens = $state<AccessToken[]>([]);

	let newName = $state('');
	let newExpiry = $state('never');
	let creating = $state(false);
	let revokingId = $state<string | null>(null);

	// The plaintext token is shown exactly once, in a modal, right after creation.
	let createdToken = $state<CreatedAccessToken | null>(null);
	let showCreated = $state(false);

	const expiryOptions = [
		{ label: 'Never expires', value: 'never' },
		{ label: '30 days', value: '30' },
		{ label: '90 days', value: '90' },
		{ label: '1 year', value: '365' }
	];

	async function refresh() {
		try {
			tokens = await api.auth.listTokens();
		} catch {
			// Leave the current list in place on a transient fetch error.
		}
	}

	onMount(refresh);

	async function createToken() {
		const name = newName.trim();
		if (!name) {
			toast.add({ title: 'Give the token a name', color: 'error' });
			return;
		}
		creating = true;
		try {
			const expiresInDays = newExpiry === 'never' ? null : Number(newExpiry);
			const created = await api.auth.createToken({ name, expiresInDays });
			createdToken = created;
			showCreated = true;
			newName = '';
			newExpiry = 'never';
			await refresh();
		} catch (err: unknown) {
			const msg =
				(err as { data?: { message?: string } })?.data?.message ?? 'Failed to create token';
			toast.add({ title: msg, color: 'error' });
		} finally {
			creating = false;
		}
	}

	async function revokeToken(id: string) {
		revokingId = id;
		try {
			await api.auth.revokeToken(id);
			toast.add({ title: 'Token revoked', color: 'success' });
			await refresh();
		} catch {
			toast.add({ title: 'Failed to revoke token', color: 'error' });
		} finally {
			revokingId = null;
		}
	}

	async function copyToken() {
		if (!createdToken) return;
		try {
			await navigator.clipboard.writeText(createdToken.token);
			toast.add({ title: 'Token copied to clipboard', color: 'success' });
		} catch {
			toast.add({ title: 'Could not copy — select and copy manually', color: 'error' });
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

	// Clear the captured plaintext once the show-once modal closes.
	$effect(() => {
		if (!showCreated) createdToken = null;
	});
</script>

<AppPanel
	title="MCP access tokens"
	description="Connect the Alcoves MCP server. A token acts as you — it can only read and change what you can."
	icon={ICONS.key}
>
	{#snippet actions()}
		<span class="badge preset-tonal-surface">{tokens.length} active</span>
	{/snippet}

	<div class="space-y-5">
		<!-- Create -->
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
			<label class="flex-1 space-y-1">
				<span class="block text-sm font-medium">Name</span>
				<input
					class="input w-full"
					placeholder="e.g. Claude Desktop on laptop"
					bind:value={newName}
					disabled={creating}
					onkeyup={(e) => {
						if (e.key === 'Enter') createToken();
					}}
				/>
				<span class="block text-xs text-surface-600-400">What is this token for?</span>
			</label>
			<label class="space-y-1">
				<span class="block text-sm font-medium">Expires</span>
				<select class="select" bind:value={newExpiry} disabled={creating}>
					{#each expiryOptions as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
			<button
				type="button"
				class="btn preset-filled-primary-500"
				disabled={creating}
				onclick={createToken}
			>
				{#if creating}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.plus} class="size-4" />
				{/if}
				Create token
			</button>
		</div>

		<hr class="border-surface-200-800" />

		<!-- List -->
		{#if tokens.length}
			<div class="overflow-hidden rounded-md border border-surface-200-800">
				{#each tokens as token (token.id)}
					<div
						class="flex flex-col gap-2 border-b border-surface-200-800 px-4 py-3 last:border-b-0 md:flex-row md:items-center"
					>
						<div class="flex min-w-0 flex-1 items-center gap-3">
							<div
								class="flex size-9 shrink-0 items-center justify-center rounded-full preset-tonal-surface"
							>
								<AppIcon name={ICONS.key} class="size-4" />
							</div>
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{token.name}</p>
								<div
									class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-surface-600-400"
								>
									<span>Created {formatDate(token.createdAt)}</span>
									<span aria-hidden="true">·</span>
									<span>Expires {formatDate(token.expiresAt)}</span>
									<span aria-hidden="true">·</span>
									<span>
										{token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : 'Never used'}
									</span>
								</div>
							</div>
						</div>
						<button
							type="button"
							class="btn preset-tonal-error btn-sm"
							disabled={revokingId === token.id}
							onclick={() => revokeToken(token.id)}
						>
							{#if revokingId === token.id}
								<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
							{:else}
								<AppIcon name={ICONS.trash} class="size-4" />
							{/if}
							Revoke
						</button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex items-start gap-3 card preset-tonal-surface p-4">
				<AppIcon name={ICONS.key} class="size-5 shrink-0 opacity-70" />
				<div class="space-y-0.5">
					<p class="text-sm font-medium">No access tokens yet</p>
					<p class="text-xs text-surface-600-400">
						Create one to connect an MCP client to your Alcoves libraries.
					</p>
				</div>
			</div>
		{/if}
	</div>
</AppPanel>

<!-- Show-once token modal -->
<AppModal
	bind:open={showCreated}
	title="Copy your new token"
	description="This is the only time the token is shown. Store it somewhere safe."
>
	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<input class="input w-full font-mono text-xs" value={createdToken?.token ?? ''} readonly />
			<button
				type="button"
				class="btn-icon shrink-0 preset-tonal-surface"
				aria-label="Copy token"
				onclick={copyToken}
			>
				<AppIcon name={ICONS.copy} class="size-4" />
			</button>
		</div>
		<div class="flex items-start gap-3 card preset-tonal-warning p-4">
			<AppIcon name={ICONS.shield} class="size-5 shrink-0 opacity-80" />
			<div class="space-y-0.5">
				<p class="text-sm font-medium">Treat it like a password</p>
				<p class="text-xs opacity-80">
					Anyone with this token can access your libraries as you. Revoke it if it leaks.
				</p>
			</div>
		</div>
		<div class="flex w-full justify-end">
			<button
				type="button"
				class="btn preset-filled-primary-500"
				onclick={() => (showCreated = false)}
			>
				Done
			</button>
		</div>
	</div>
</AppModal>
