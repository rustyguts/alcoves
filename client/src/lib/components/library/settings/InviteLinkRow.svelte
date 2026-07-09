<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryInviteLink } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

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

<div class="flex flex-col gap-2 px-3 py-3 transition-colors hover:bg-muted/60">
	<div class="flex flex-col gap-3 md:flex-row md:items-center">
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-medium">{invite.inviteUrl}</p>
			<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span>{usageLabel}</span>
				<span>·</span>
				<span>{expiresLabel}</span>
				{#if isExhausted}
					<Badge variant="outline" class="border-transparent bg-warning/10 text-warning">
						Exhausted
					</Badge>
				{/if}
				{#if isExpired}
					<Badge variant="destructive">Expired</Badge>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if uses.length}
				<Button variant="ghost" size="sm" onclick={() => (expanded = !expanded)}>
					<AppIcon name={expanded ? ICONS.chevronUp : ICONS.chevronDown} class="size-4" />
					{uses.length}
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Copy invite link"
				onclick={() => oncopy?.(invite.inviteUrl)}
			>
				<AppIcon name={ICONS.copy} class="size-4" />
			</Button>
			<Button
				variant="destructive"
				size="icon-sm"
				aria-label="Revoke invite link"
				disabled={revoking}
				onclick={() => onrevoke?.(invite.id)}
			>
				{#if revoking}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.trash} class="size-4" />
				{/if}
			</Button>
		</div>
	</div>
	{#if expanded && uses.length}
		<div class="space-y-2 rounded-lg bg-muted/50 px-3 py-2">
			{#each uses as u, idx (idx)}
				<div class="flex items-center gap-2 text-xs">
					<UserAvatar displayName={u.user.displayName} avatarUrl={u.user.avatarUrl} size="xs" />
					<div class="min-w-0 flex-1">
						<p class="truncate">{u.user.displayName}</p>
						<p class="truncate text-muted-foreground">{u.user.email}</p>
					</div>
					<span class="text-muted-foreground">{new Date(u.usedAt).toLocaleString()}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
