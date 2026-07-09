<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryMemberWithUser } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	interface RoleOption {
		label: string;
		value: 'admin' | 'viewer';
	}

	interface Props {
		member: LibraryMemberWithUser;
		roleDraft: 'admin' | 'viewer';
		updatingRole: boolean;
		removing: boolean;
		roleOptions: RoleOption[];
		onupdateRole?: (member: LibraryMemberWithUser, role: 'admin' | 'viewer') => void;
		onremove?: (member: LibraryMemberWithUser) => void;
	}

	let { member, roleDraft, updatingRole, removing, roleOptions, onupdateRole, onremove }: Props =
		$props();

	const roleLabel = $derived(roleOptions.find((o) => o.value === roleDraft)?.label ?? roleDraft);
</script>

<div
	class="flex flex-col gap-3 px-3 py-3 transition-colors hover:bg-muted/60 md:flex-row md:items-center"
>
	<div class="flex min-w-0 flex-1 items-center gap-3">
		<UserAvatar displayName={member.user.displayName} avatarUrl={member.user.avatarUrl} size="md" />
		<div class="min-w-0">
			<p class="truncate text-sm font-medium">{member.user.displayName}</p>
			<p class="truncate text-xs text-muted-foreground">{member.user.email}</p>
		</div>
	</div>

	<div class="flex items-center gap-2">
		{#if member.role === 'owner'}
			<Badge variant="secondary">owner</Badge>
		{:else}
			<Select.Root
				type="single"
				value={roleDraft}
				disabled={updatingRole}
				onValueChange={(value) => onupdateRole?.(member, value as 'admin' | 'viewer')}
			>
				<Select.Trigger
					size="sm"
					class="w-28"
					aria-label={`Change role for ${member.user.displayName}`}
				>
					{roleLabel}
				</Select.Trigger>
				<Select.Content>
					{#each roleOptions as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
			<Button
				variant="destructive"
				size="icon-sm"
				aria-label="Remove member"
				title="Remove member"
				disabled={removing}
				onclick={() => onremove?.(member)}
			>
				{#if removing}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.user} class="size-4" />
				{/if}
			</Button>
		{/if}
	</div>
</div>
