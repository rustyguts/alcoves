<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryInviteLink } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';

	interface Props {
		invite: LibraryInviteLink;
		revoking: boolean;
		oncopy?: (inviteUrl: string) => void;
		onrevoke?: (inviteId: string) => void;
	}

	let { invite, revoking, oncopy, onrevoke }: Props = $props();

	let expanded = $state(false);

	const usageLabel = $derived.by(() => {
		const used = invite.useCount;
		const max = invite.maxUses;
		if (max == null) return `${used} ${used === 1 ? 'use' : 'uses'}`;
		return `${used} / ${max} uses`;
	});

	const expiresLabel = $derived.by(() => {
		if (!invite.expiresAt) return 'Never expires';
		const d = new Date(invite.expiresAt);
		return `Expires ${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
	});

	const isExhausted = $derived(invite.maxUses != null && invite.useCount >= invite.maxUses);
	const isExpired = $derived(
		invite.expiresAt != null && new Date(invite.expiresAt).getTime() < Date.now()
	);
	const uses = $derived(invite.uses ?? []);
</script>

<div class="flex flex-col gap-2 px-3 py-3">
	<div class="flex flex-col gap-3 md:flex-row md:items-center">
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-medium">{invite.inviteUrl}</p>
			<div class="flex flex-wrap items-center gap-2 text-xs opacity-75">
				<span>{usageLabel}</span>
				<span>·</span>
				<span>{expiresLabel}</span>
				{#if isExhausted}
					<span class="badge preset-tonal-warning">Exhausted</span>
				{/if}
				{#if isExpired}
					<span class="badge preset-tonal-error">Expired</span>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if uses.length}
				<button
					type="button"
					class="btn gap-1 preset-tonal-surface btn-sm"
					onclick={() => (expanded = !expanded)}
				>
					<AppIcon name={expanded ? ICONS.chevronUp : ICONS.chevronDown} class="size-4" />
					{uses.length}
				</button>
			{/if}
			<button
				type="button"
				class="btn-icon btn-icon-sm preset-tonal-surface"
				aria-label="Copy invite link"
				onclick={() => oncopy?.(invite.inviteUrl)}
			>
				<AppIcon name={ICONS.copy} class="size-4" />
			</button>
			<button
				type="button"
				class="btn-icon btn-icon-sm preset-tonal-error"
				aria-label="Revoke invite link"
				disabled={revoking}
				onclick={() => onrevoke?.(invite.id)}
			>
				{#if revoking}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.trash} class="size-4" />
				{/if}
			</button>
		</div>
	</div>
	{#if expanded && uses.length}
		<div class="space-y-2 rounded-md border border-surface-200-800 bg-surface-100-900/30 px-3 py-2">
			{#each uses as u, idx (idx)}
				<div class="flex items-center gap-2 text-xs">
					<UserAvatar
						displayName={u.user.displayName}
						avatarUrl={u.user.avatarUrl}
						sizeClass="w-6"
					/>
					<div class="min-w-0 flex-1">
						<p class="truncate">{u.user.displayName}</p>
						<p class="truncate opacity-75">{u.user.email}</p>
					</div>
					<span class="opacity-75">{new Date(u.usedAt).toLocaleString()}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
