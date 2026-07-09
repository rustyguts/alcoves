<script lang="ts">
	import { onMount } from 'svelte';
	import SettingsSection from '$lib/components/library/settings/SettingsSection.svelte';
	import AppModal from '$lib/components/ui/AppModal.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
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

	const newExpiryLabel = $derived(
		expiryOptions.find((o) => o.value === newExpiry)?.label ?? 'Never expires'
	);

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

<SettingsSection
	title="MCP access tokens"
	description="Connect the Alcoves MCP server. A token acts as you — it can only read and change what you can."
	icon={ICONS.key}
>
	{#snippet actions()}
		<Badge variant="secondary">{tokens.length} active</Badge>
	{/snippet}

	<div class="flex flex-col gap-5">
		<!-- Create -->
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
			<Field.Field class="flex-1">
				<Label for="new-token-name">Name</Label>
				<Input
					id="new-token-name"
					placeholder="e.g. Claude Desktop on laptop"
					bind:value={newName}
					disabled={creating}
					onkeyup={(e) => {
						if (e.key === 'Enter') createToken();
					}}
				/>
				<Field.Description>What is this token for?</Field.Description>
			</Field.Field>
			<Field.Field class="sm:w-40">
				<Label for="new-token-expiry">Expires</Label>
				<Select.Root
					type="single"
					value={newExpiry}
					onValueChange={(v) => {
						if (v) newExpiry = v;
					}}
					disabled={creating}
				>
					<Select.Trigger id="new-token-expiry" aria-label="Expires" class="w-full">
						{newExpiryLabel}
					</Select.Trigger>
					<Select.Content>
						{#each expiryOptions as opt (opt.value)}
							<Select.Item value={opt.value} label={opt.label} />
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Button disabled={creating} onclick={createToken}>
				{#if creating}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.plus} class="size-4" />
				{/if}
				Create token
			</Button>
		</div>

		<Separator.Root />

		<!-- List -->
		{#if tokens.length}
			<div class="overflow-hidden rounded-xl bg-muted/50">
				<Item.Group>
					{#each tokens as token (token.id)}
						<Item.Root class="hover:bg-muted/60">
							<Item.Media variant="icon" class="size-9 rounded-full bg-muted text-muted-foreground">
								<AppIcon name={ICONS.key} class="size-4" />
							</Item.Media>
							<Item.Content>
								<Item.Title>{token.name}</Item.Title>
								<Item.Description>
									Created {formatDate(token.createdAt)} · Expires {formatDate(token.expiresAt)} · {token.lastUsedAt
										? `Last used ${formatDate(token.lastUsedAt)}`
										: 'Never used'}
								</Item.Description>
							</Item.Content>
							<Item.Actions>
								<Button
									variant="ghost"
									size="sm"
									disabled={revokingId === token.id}
									onclick={() => revokeToken(token.id)}
								>
									{#if revokingId === token.id}
										<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
									{:else}
										<AppIcon name={ICONS.trash} class="size-4" />
									{/if}
									Revoke
								</Button>
							</Item.Actions>
						</Item.Root>
					{/each}
				</Item.Group>
			</div>
		{:else}
			<div class="flex items-start gap-3 rounded-lg bg-muted/30 p-4">
				<AppIcon name={ICONS.key} class="size-5 shrink-0 opacity-70" />
				<div class="space-y-0.5">
					<p class="text-sm font-medium">No access tokens yet</p>
					<p class="text-xs text-muted-foreground">
						Create one to connect an MCP client to your Alcoves libraries.
					</p>
				</div>
			</div>
		{/if}
	</div>
</SettingsSection>

<!-- Show-once token modal -->
<AppModal
	bind:open={showCreated}
	title="Copy your new token"
	description="This is the only time the token is shown. Store it somewhere safe."
>
	<div class="flex flex-col gap-4">
		<InputGroup.Root>
			<InputGroup.Input value={createdToken?.token ?? ''} readonly class="font-mono text-xs" />
			<InputGroup.Addon align="inline-end">
				<InputGroup.Button aria-label="Copy token" onclick={copyToken}>
					<AppIcon name={ICONS.copy} class="size-4" />
				</InputGroup.Button>
			</InputGroup.Addon>
		</InputGroup.Root>
		<div class="flex items-start gap-3 rounded-lg bg-warning/10 p-4 text-warning">
			<AppIcon name={ICONS.shield} class="size-5 shrink-0" />
			<div class="space-y-0.5">
				<p class="text-sm font-medium">Treat it like a password</p>
				<p class="text-xs opacity-80">
					Anyone with this token can access your libraries as you. Revoke it if it leaks.
				</p>
			</div>
		</div>
		<div class="flex w-full justify-end">
			<Button onclick={() => (showCreated = false)}>Done</Button>
		</div>
	</div>
</AppModal>
