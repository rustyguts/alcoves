<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { ApiError } from '$lib/api';
	import { auth } from '$lib/state/auth.svelte';
	import { refreshLibraries } from '$lib/state/libraries-list.svelte';
	import { toast } from '$lib/state/toast';
	import { ICONS } from '$lib/utils/icons';
	import { cn } from '$lib/utils';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import AuthCardShell from '$lib/components/ui/AuthCardShell.svelte';
	import type { InviteLookupResponse } from '$lib/types/api';

	const token = $derived(page.params.token ?? '');

	let invite = $state<InviteLookupResponse | null>(null);
	let loading = $state(true);
	let accepting = $state(false);

	// Public route (outside the authed shell), so resolve the session ourselves.
	// Anon visitors get sent to register-with-invite; once they finish registering
	// the backend auto-accepts the invite and lands them in the target library.
	onMount(async () => {
		if (!auth.loggedIn) {
			await auth.fetchSession();
			if (!auth.loggedIn) {
				goto(`/register?invite=${encodeURIComponent(token)}`);
				return;
			}
		}
		await loadInvite();
	});

	async function loadInvite() {
		loading = true;
		try {
			invite = await api.invites.lookup(token);
		} catch {
			invite = null;
		} finally {
			loading = false;
		}
	}

	const inviteTitle = $derived.by(() => {
		if (!invite) return 'Library invite';
		return `${invite.invitedBy.displayName} has invited you to join ${invite.library.name}`;
	});

	const statusMessage = $derived.by(() => {
		switch (invite?.status) {
			case 'pending':
				return 'Accept this invitation to get access to the library.';
			case 'already_member':
				return 'You already have access to this library.';
			case 'expired':
				return 'This invitation has expired.';
			case 'revoked':
				return 'This invitation was revoked by a library admin.';
			case 'exhausted':
				return 'This invitation has reached its maximum number of uses.';
			default:
				return 'Invite details unavailable.';
		}
	});

	const statusIcon = $derived.by(() => {
		switch (invite?.status) {
			case 'already_member':
				return ICONS.success;
			case 'expired':
			case 'revoked':
			case 'exhausted':
				return ICONS.error;
			default:
				return ICONS.info;
		}
	});

	const statusTone = $derived.by(() => {
		switch (invite?.status) {
			case 'already_member':
				return 'text-success';
			case 'expired':
			case 'revoked':
			case 'exhausted':
				return 'text-destructive';
			default:
				return 'text-primary';
		}
	});

	async function acceptInvite() {
		if (!invite?.canAccept) return;
		accepting = true;
		try {
			const result = await api.invites.accept(token);
			await refreshLibraries();
			toast.add({ title: 'Joined library', color: 'success' });
			goto(`/libraries/${result.libraryId}`);
		} catch (err: unknown) {
			const message =
				err instanceof ApiError
					? ((err.data?.message as string) ?? 'Failed to accept invite')
					: 'Failed to accept invite';
			toast.add({ title: message, color: 'error' });
			await loadInvite();
		} finally {
			accepting = false;
		}
	}
</script>

<AuthCardShell title="Library invite" subtitle="You'll join with member access.">
	<div class="flex flex-col gap-4">
		<div class="flex items-center gap-3">
			{#if invite}
				<UserAvatar
					displayName={invite.invitedBy.displayName}
					avatarUrl={invite.invitedBy.avatarUrl}
					size="lg"
				/>
			{/if}
			<h1 class="text-base font-semibold">{inviteTitle}</h1>
		</div>

		{#if loading}
			<div class="flex items-center justify-center py-8">
				<AppIcon name={ICONS.loading} class="size-5 animate-spin text-muted-foreground" />
			</div>
		{:else}
			<div class="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm" role="status">
				<AppIcon name={statusIcon} class={cn('mt-0.5 size-4 shrink-0', statusTone)} />
				<span>{statusMessage}</span>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				{#if invite?.canAccept}
					<Button disabled={accepting} onclick={acceptInvite}>
						{#if accepting}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.check} class="size-4" />
						{/if}
						Accept Invite
					</Button>
				{/if}
				{#if invite?.library.id}
					<Button href={`/libraries/${invite.library.id}`} variant="outline">
						Go to library
						<AppIcon name={ICONS.arrowRight} class="size-4" />
					</Button>
				{/if}
			</div>
		{/if}
	</div>
</AuthCardShell>
