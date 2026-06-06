<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/state/auth.svelte';
	import { theme, type ColorPreference } from '$lib/state/theme.svelte';
	import { toast } from '$lib/state/toast';
	import { api, apiUrl, ApiError } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AccessTokensSection from '$lib/components/profile/AccessTokensSection.svelte';
	import type { PageProps } from './$types';
	import type { SessionInfo } from '$lib/types/api';

	let { data }: PageProps = $props();

	const MAX_AVATAR_UPLOAD_BYTES = 25 * 1024 * 1024;

	// Prefer the live auth store (kept fresh after profile mutations), falling back
	// to the SSR-resolved layout user the authed shell already provides.
	const user = $derived(auth.user ?? data.user);

	let displayName = $state('');
	let avatarInput = $state<HTMLInputElement | null>(null);
	let selectedAvatar = $state<File | null>(null);
	let avatarPreviewUrl = $state<string | null>(null);
	let saving = $state(false);

	// Seed the editable name from the resolved user, and re-seed whenever the
	// underlying user changes (e.g. after a save round-trips a new display name).
	let lastSyncedName = $state<string | null>(null);
	$effect(() => {
		const next = user?.displayName ?? '';
		if (next !== lastSyncedName) {
			displayName = next;
			lastSyncedName = next;
		}
	});

	const currentAvatarSrc = $derived.by(() => {
		if (avatarPreviewUrl) return avatarPreviewUrl;
		const remote = user?.avatarUrl;
		return remote ? apiUrl(remote) : null;
	});
	const avatarInitial = $derived((user?.displayName ?? 'U').charAt(0).toUpperCase());
	const hasProfileChanges = $derived.by(() => {
		const nextDisplayName = displayName.trim();
		const hasDisplayNameUpdate = !!(nextDisplayName && nextDisplayName !== user?.displayName);
		return hasDisplayNameUpdate || !!selectedAvatar;
	});

	function openAvatarPicker() {
		avatarInput?.click();
	}

	function onAvatarSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			toast.add({ title: 'Please select an image file', color: 'error' });
			input.value = '';
			return;
		}
		if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
			toast.add({ title: 'Avatar image is too large (max 25MB)', color: 'error' });
			input.value = '';
			return;
		}
		selectedAvatar = file;
		if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
		avatarPreviewUrl = URL.createObjectURL(file);
	}

	function discardAvatar() {
		selectedAvatar = null;
		if (avatarInput) avatarInput.value = '';
		if (avatarPreviewUrl) {
			URL.revokeObjectURL(avatarPreviewUrl);
			avatarPreviewUrl = null;
		}
	}

	onMount(() => {
		return () => {
			if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
		};
	});

	async function save() {
		saving = true;
		try {
			const nextDisplayName = displayName.trim();
			const hasDisplayNameUpdate = !!(nextDisplayName && nextDisplayName !== user?.displayName);
			const hasAvatarUpdate = !!selectedAvatar;

			if (!hasDisplayNameUpdate && !hasAvatarUpdate) {
				toast.add({ title: 'No changes to save', color: 'neutral' });
				return;
			}

			if (hasDisplayNameUpdate) await auth.updateProfile({ displayName: nextDisplayName });
			if (selectedAvatar) await auth.uploadAvatar(selectedAvatar);

			discardAvatar();
			toast.add({ title: 'Profile updated', color: 'success' });
		} catch (error) {
			const message = error instanceof ApiError ? error.message : 'Failed to update profile';
			toast.add({ title: message, color: 'error' });
		} finally {
			saving = false;
		}
	}

	let sessions = $state<SessionInfo[]>([]);
	let revokingId = $state<string | null>(null);

	async function refreshSessions() {
		try {
			sessions = await api.auth.listSessions();
		} catch {
			// Leave the current list in place on a transient fetch error.
		}
	}

	onMount(refreshSessions);

	async function revokeSession(id: string) {
		revokingId = id;
		try {
			await api.auth.revokeSession(id);
			toast.add({ title: 'Session revoked', color: 'success' });
			await refreshSessions();
		} catch {
			toast.add({ title: 'Failed to revoke session', color: 'error' });
		} finally {
			revokingId = null;
		}
	}

	function parseBrowser(ua: string | null): string {
		if (!ua) return 'Unknown device';
		if (ua.includes('Firefox')) return 'Firefox';
		if (ua.includes('Edg/')) return 'Edge';
		if (ua.includes('Chrome')) return 'Chrome';
		if (ua.includes('Safari')) return 'Safari';
		return 'Unknown browser';
	}

	function formatSessionDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}

	const themeOptions: { label: string; value: ColorPreference; icon: string; hint: string }[] = [
		{ label: 'System', value: 'system', icon: ICONS.system, hint: 'Match device' },
		{ label: 'Light', value: 'light', icon: ICONS.light, hint: 'Always light' },
		{ label: 'Dark', value: 'dark', icon: ICONS.dark, hint: 'Always dark' }
	];

	// Silence the unused-page warning while keeping the import wired for parity with peers.
	void page;
</script>

<div class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto px-0.5 pb-8">
	<!-- Identity hero — flat, sits directly on the page, no card chrome -->
	<header class="flex flex-col items-center gap-5 pt-1 text-center sm:flex-row sm:text-left">
		<button
			type="button"
			class="group relative shrink-0 rounded-full transition focus:outline-none"
			onclick={openAvatarPicker}
		>
			{#if currentAvatarSrc}
				<img
					src={currentAvatarSrc}
					alt={user?.displayName ?? 'User'}
					class="aspect-square w-24 rounded-full object-cover ring-4 ring-surface-200-800 transition group-hover:ring-primary-500/30"
				/>
			{:else}
				<span
					class="inline-flex aspect-square w-24 items-center justify-center rounded-full preset-tonal-surface text-3xl font-medium ring-4 ring-surface-200-800 transition group-hover:ring-primary-500/30"
					aria-label={user?.displayName ?? 'User'}
				>
					{avatarInitial}
				</span>
			{/if}
			<span
				class="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition group-hover:opacity-100"
			>
				<AppIcon name={ICONS.camera} class="size-6 text-white" />
			</span>
		</button>

		<div class="min-w-0 flex-1">
			<h1 class="truncate text-2xl font-semibold">
				{user?.displayName || 'Your profile'}
			</h1>
			<div
				class="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 sm:justify-start"
			>
				<span class="inline-flex max-w-full items-center gap-1.5 text-sm text-surface-600-400">
					<AppIcon name={ICONS.email} class="size-4 shrink-0" />
					<span class="break-all">{user?.email}</span>
				</span>
				{#if user?.role}
					<span
						class="badge capitalize {user.role === 'owner'
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
					>
						{user.role}
					</span>
				{/if}
			</div>
			<button
				type="button"
				class="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary-500 transition hover:text-primary-600"
				onclick={openAvatarPicker}
			>
				<AppIcon name={ICONS.camera} class="size-3.5" />
				Change photo
			</button>
		</div>

		<input
			bind:this={avatarInput}
			type="file"
			accept="image/*"
			class="hidden"
			onchange={onAvatarSelected}
		/>
	</header>

	<!-- Account -->
	<AppPanel
		title="Account"
		description="Update how your name appears across Alcoves."
		icon={ICONS.person}
	>
		{#snippet actions()}
			<button
				type="button"
				class="btn preset-filled-primary-500"
				disabled={!hasProfileChanges || saving}
				onclick={save}
			>
				{#if saving}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.save} class="size-4" />
				{/if}
				Save changes
			</button>
		{/snippet}

		<div class="space-y-4">
			<label class="block space-y-1">
				<span class="block text-sm font-medium">Display name</span>
				<input class="input w-full" placeholder="Display name" bind:value={displayName} />
			</label>

			{#if selectedAvatar}
				<div
					class="flex flex-wrap items-center justify-between gap-2 rounded-md preset-tonal-primary px-3 py-2 text-sm"
				>
					<span class="inline-flex items-center gap-2">
						<AppIcon name={ICONS.camera} class="size-4 shrink-0" />
						New photo selected — save changes to apply.
					</span>
					<button type="button" class="btn preset-tonal-primary btn-sm" onclick={discardAvatar}>
						Discard
					</button>
				</div>
			{/if}
		</div>
	</AppPanel>

	<!-- Appearance -->
	<AppPanel
		title="Appearance"
		description="Choose how Alcoves looks on this device."
		icon={ICONS.appearance}
	>
		<div class="grid grid-cols-3 gap-2 sm:gap-3">
			{#each themeOptions as opt (opt.value)}
				<button
					type="button"
					class="relative flex flex-col items-center gap-1.5 rounded-md px-3 py-4 text-center transition {theme.preference ===
					opt.value
						? 'preset-tonal-primary ring-1 ring-primary-500 ring-inset'
						: 'preset-tonal-surface hover:preset-filled-surface-100-900'}"
					onclick={() => theme.set(opt.value)}
				>
					{#if theme.preference === opt.value}
						<AppIcon name={ICONS.success} class="absolute top-2 right-2 size-4 text-primary-500" />
					{/if}
					<AppIcon
						name={opt.icon}
						class="size-6 {theme.preference === opt.value
							? 'text-primary-500'
							: 'text-surface-600-400'}"
					/>
					<span class="text-sm font-medium">{opt.label}</span>
					<span class="text-xs text-surface-600-400">{opt.hint}</span>
				</button>
			{/each}
		</div>
	</AppPanel>

	<!-- Active sessions -->
	<AppPanel
		title="Active sessions"
		description="Revoke any session you don't recognise."
		icon={ICONS.admin}
	>
		{#snippet actions()}
			<span class="badge preset-tonal-surface">{sessions.length}</span>
		{/snippet}

		{#if sessions.length}
			<div class="overflow-hidden rounded-md border border-surface-200-800">
				{#each sessions as session (session.id)}
					<div
						class="flex flex-wrap items-center justify-between gap-3 border-b border-surface-200-800 px-4 py-3 last:border-b-0"
					>
						<div class="flex min-w-0 items-center gap-3">
							<div
								class="flex size-9 shrink-0 items-center justify-center rounded-full preset-tonal-surface"
							>
								<AppIcon name={ICONS.system} class="size-4" />
							</div>
							<div class="min-w-0 space-y-0.5">
								<div class="flex items-center gap-2">
									<span class="truncate text-sm font-medium">
										{parseBrowser(session.userAgent)}
									</span>
									{#if session.isCurrent}
										<span class="badge preset-tonal-primary">Current</span>
									{/if}
								</div>
								<div
									class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-surface-600-400"
								>
									{#if session.ipAddress}
										<span>{session.ipAddress}</span>
										<span aria-hidden="true">·</span>
									{/if}
									<span>Signed in {formatSessionDate(session.createdAt)}</span>
								</div>
							</div>
						</div>
						{#if !session.isCurrent}
							<button
								type="button"
								class="btn preset-tonal-error btn-sm"
								disabled={revokingId === session.id}
								onclick={() => revokeSession(session.id)}
							>
								{#if revokingId === session.id}
									<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
								{/if}
								Revoke
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex items-start gap-3 card preset-tonal-surface p-4">
				<AppIcon name={ICONS.admin} class="size-5 shrink-0 opacity-70" />
				<div class="space-y-0.5">
					<p class="text-sm font-medium">No other active sessions</p>
					<p class="text-xs text-surface-600-400">Only this browser session is active right now.</p>
				</div>
			</div>
		{/if}
	</AppPanel>

	<AccessTokensSection />
</div>
