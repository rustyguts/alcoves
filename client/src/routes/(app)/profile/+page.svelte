<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/state/auth.svelte';
	import { theme, type ColorPreference } from '$lib/state/theme.svelte';
	import { toast } from '$lib/state/toast';
	import { api, apiUrl, ApiError } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import SettingsSection from '$lib/components/library/settings/SettingsSection.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import AccessTokensSection from '$lib/components/profile/AccessTokensSection.svelte';
	import ConnectedAppsSection from '$lib/components/profile/ConnectedAppsSection.svelte';
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

	// F15 rework: bits-ui's `type="single"` ToggleGroup deselects to "" on a
	// re-click of the already-active item. The prior code passed `value`
	// one-way, so that "" got stuck as an unbound local override on the
	// vendored wrapper's `$bindable` prop with no way back — Svelte only
	// re-syncs a one-way bindable when the parent's VALUE actually changes,
	// and re-clicking the current theme doesn't change it. Bind two-way to a
	// local mirror instead and immediately snap "" back to the current theme
	// in the change handler, so the group is never rendered with nothing
	// selected. `lastSyncedTheme` mirrors the `lastSyncedName` idiom above:
	// re-sync `selectedTheme` FROM `theme.preference` only when the latter
	// changes externally (e.g. the async OS-preference bootstrap in the root
	// layout's `theme.init()`), without fighting the user's own toggle clicks.
	// `selectedTheme` is typed loosely (`string`, not `ColorPreference`) to
	// match the bits-ui `ToggleGroup` single-select value type, which can
	// momentarily be `""` on deselect — see the change handler below.
	let selectedTheme = $state<string>(theme.preference);
	let lastSyncedTheme = $state<ColorPreference>(theme.preference);
	$effect(() => {
		if (theme.preference !== lastSyncedTheme) {
			selectedTheme = theme.preference;
			lastSyncedTheme = theme.preference;
		}
	});

	function onThemeToggleChange(value: string) {
		if (!value) {
			selectedTheme = theme.preference;
			return;
		}
		theme.set(value as ColorPreference);
		lastSyncedTheme = value as ColorPreference;
	}

	// Silence the unused-page warning while keeping the import wired for parity with peers.
	void page;
</script>

<div class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto px-0.5 pb-8">
	<!-- Identity hero — flat, sits directly on the page, no card chrome -->
	<header class="flex flex-col items-center gap-5 pt-1 text-center sm:flex-row sm:text-left">
		<!-- F23 rework: focus-visible ring (spec's custom-focusable convention) so
		     keyboard users can see this button is focused, an aria-label since the
		     button otherwise only exposes the avatar's name (not its action), and
		     group-focus-visible so the camera overlay reveals on keyboard focus too,
		     not just pointer hover. -->
		<button
			type="button"
			aria-label="Change profile photo"
			class="group relative shrink-0 rounded-full transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
			onclick={openAvatarPicker}
		>
			<Avatar.Root class="size-24 ring-4 ring-border transition group-hover:ring-primary/30">
				{#if currentAvatarSrc}
					<Avatar.Image
						src={currentAvatarSrc}
						alt={user?.displayName ?? 'User'}
						class="object-cover"
					/>
				{/if}
				<Avatar.Fallback aria-label={user?.displayName ?? 'User'} class="text-3xl font-medium">
					{avatarInitial}
				</Avatar.Fallback>
			</Avatar.Root>
			<span
				class="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
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
				<span class="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground">
					<AppIcon name={ICONS.email} class="size-4 shrink-0" />
					<span class="break-all">{user?.email}</span>
				</span>
				{#if user?.role}
					<Badge variant={user.role === 'owner' ? 'default' : 'secondary'} class="capitalize">
						{user.role}
					</Badge>
				{/if}
			</div>
			<button
				type="button"
				class="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition hover:text-primary/80"
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
	<SettingsSection
		title="Account"
		description="Update how your name appears across Alcoves."
		icon={ICONS.person}
	>
		{#snippet actions()}
			<Button disabled={!hasProfileChanges || saving} onclick={save}>
				{#if saving}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.save} class="size-4" />
				{/if}
				Save changes
			</Button>
		{/snippet}

		<div class="flex flex-col gap-4">
			<Field.Field>
				<Label for="profile-display-name">Display name</Label>
				<Input id="profile-display-name" placeholder="Display name" bind:value={displayName} />
			</Field.Field>

			{#if selectedAvatar}
				<div
					class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary"
				>
					<span class="inline-flex items-center gap-2">
						<AppIcon name={ICONS.camera} class="size-4 shrink-0" />
						New photo selected — save changes to apply.
					</span>
					<Button variant="ghost" size="sm" onclick={discardAvatar}>Discard</Button>
				</div>
			{/if}
		</div>
	</SettingsSection>

	<!-- Appearance -->
	<SettingsSection
		title="Appearance"
		description="Choose how Alcoves looks on this device."
		icon={ICONS.appearance}
	>
		<ToggleGroup.Root
			type="single"
			variant="outline"
			spacing={2}
			bind:value={selectedTheme}
			onValueChange={onThemeToggleChange}
			class="grid w-full grid-cols-3 gap-2 sm:gap-3"
		>
			{#each themeOptions as opt (opt.value)}
				<ToggleGroup.Item
					value={opt.value}
					class="relative h-auto flex-col gap-1.5 rounded-md px-3 py-4 text-center data-[state=on]:ring-1 data-[state=on]:ring-primary data-[state=on]:ring-inset"
				>
					{#if theme.preference === opt.value}
						<AppIcon name={ICONS.success} class="absolute top-2 right-2 size-4 text-primary" />
					{/if}
					<AppIcon
						name={opt.icon}
						class="size-6 {theme.preference === opt.value
							? 'text-primary'
							: 'text-muted-foreground'}"
					/>
					<span class="text-sm font-medium">{opt.label}</span>
					<span class="text-xs text-muted-foreground">{opt.hint}</span>
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
	</SettingsSection>

	<!-- Active sessions -->
	<SettingsSection
		title="Active sessions"
		description="Revoke any session you don't recognise."
		icon={ICONS.admin}
	>
		{#snippet actions()}
			<Badge variant="secondary">{sessions.length}</Badge>
		{/snippet}

		{#if sessions.length}
			<div class="overflow-hidden rounded-xl bg-muted/50">
				<Item.Group>
					{#each sessions as session (session.id)}
						<Item.Root class="hover:bg-muted/60">
							<Item.Media variant="icon" class="size-9 rounded-full bg-muted text-muted-foreground">
								<AppIcon name={ICONS.system} class="size-4" />
							</Item.Media>
							<Item.Content>
								<Item.Title>
									<span class="truncate">{parseBrowser(session.userAgent)}</span>
									{#if session.isCurrent}
										<Badge variant="secondary">Current</Badge>
									{/if}
								</Item.Title>
								<Item.Description>
									{#if session.ipAddress}
										{session.ipAddress}
										<span aria-hidden="true">·</span>
									{/if}
									Signed in {formatSessionDate(session.createdAt)}
								</Item.Description>
							</Item.Content>
							{#if !session.isCurrent}
								<Item.Actions>
									<Button
										variant="ghost"
										size="sm"
										disabled={revokingId === session.id}
										onclick={() => revokeSession(session.id)}
									>
										{#if revokingId === session.id}
											<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
										{/if}
										Revoke
									</Button>
								</Item.Actions>
							{/if}
						</Item.Root>
					{/each}
				</Item.Group>
			</div>
		{:else}
			<div class="flex items-start gap-3 rounded-lg bg-muted/30 p-4">
				<AppIcon name={ICONS.admin} class="size-5 shrink-0 opacity-70" />
				<div class="space-y-0.5">
					<p class="text-sm font-medium">No other active sessions</p>
					<p class="text-xs text-muted-foreground">
						Only this browser session is active right now.
					</p>
				</div>
			</div>
		{/if}
	</SettingsSection>

	<AccessTokensSection />

	<ConnectedAppsSection />
</div>
