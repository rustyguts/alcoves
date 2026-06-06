<script lang="ts">
	import { ICONS } from '$lib/utils/icons';
	import type { LibraryMemberWithUser } from '$lib/types/api';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';

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
</script>

<div class="flex flex-col gap-3 px-3 py-3 md:flex-row md:items-center">
	<div class="flex min-w-0 flex-1 items-center gap-3">
		<UserAvatar
			displayName={member.user.displayName}
			avatarUrl={member.user.avatarUrl}
			sizeClass="w-8"
		/>
		<div class="min-w-0">
			<p class="truncate text-sm font-medium">{member.user.displayName}</p>
			<p class="truncate text-xs text-surface-600-400">{member.user.email}</p>
		</div>
	</div>

	<div class="flex items-center gap-2">
		{#if member.role === 'owner'}
			<span class="badge preset-tonal-primary">owner</span>
		{:else}
			<select
				class="select w-28"
				value={roleDraft}
				disabled={updatingRole}
				onchange={(e) => onupdateRole?.(member, e.currentTarget.value as 'admin' | 'viewer')}
			>
				{#each roleOptions as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
			<button
				type="button"
				class="btn-icon btn-icon-sm preset-tonal-error"
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
			</button>
		{/if}
	</div>
</div>
