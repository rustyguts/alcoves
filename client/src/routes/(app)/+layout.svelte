<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { api } from '$lib/api';
	import { auth } from '$lib/state/auth.svelte';
	import { registerLibrariesRefresh } from '$lib/state/libraries-list.svelte';
	import { uploadQueue } from '$lib/state/upload-queue.svelte';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import SidebarLibraryNav from '$lib/components/SidebarLibraryNav.svelte';
	import NotificationBell from '$lib/components/notifications/NotificationBell.svelte';
	import UploadProgress from '$lib/components/UploadProgress.svelte';
	import type { LayoutProps } from './$types';

	/**
	 * Authenticated dashboard shell, built on shadcn-svelte's `Sidebar.Provider`.
	 * The mobile drawer (a Sheet) and the desktop fixed panel are the SAME
	 * `Sidebar.Root` markup — the primitive swaps between them internally via the
	 * `is-mobile` hook, so `SidebarLibraryNav` renders once and is shared between
	 * both. The header holds the mobile sidebar trigger, a global search form
	 * that navigates to `/search?q=…`, the notification bell, and a user menu.
	 * Ported faithfully from the Nuxt `dashboard.vue` layout — but reads the
	 * shell data from the `(app)` layout load (`data.user`/`data.libraries`)
	 * instead of refetching, and refreshes via `invalidateAll()`.
	 */
	let { data, children }: LayoutProps = $props();

	// Search box: seeded from the URL's `q` and re-synced as navigation changes the
	// query string, yet still user-editable (writable derived) before submit.
	let globalSearchQuery = $derived(page.url.searchParams.get('q') ?? '');

	// Let any page trigger a sidebar library-list refresh without prop-drilling.
	onMount(() => {
		registerLibrariesRefresh(() => invalidateAll());
	});

	// The authed shell unmounts on logout / leaving the app group — tear down the
	// global upload queue (abort in-flight uploads, clear timers/handles) so an
	// abandoned session doesn't leak uploads or File references.
	onDestroy(() => uploadQueue.reset());

	function submitGlobalSearch() {
		const q = globalSearchQuery.trim();
		goto(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
	}

	async function createLibrary() {
		await api.libraries.create({ name: 'Untitled Library' });
		await invalidateAll();
	}

	async function signOut() {
		await auth.logout();
	}

	const displayName = $derived(data.user?.displayName ?? 'User');
</script>

<!-- F18 rework: seed `open` from the SSR-read sidebar_state cookie (see
     +layout.server.ts) so desktop collapse survives reload/SSR nav instead of
     resetting to the primitive's default-open every time. -->
<Sidebar.Provider class="h-dvh overflow-hidden" open={data.sidebarOpen}>
	<Sidebar.Root>
		<Sidebar.Header>
			<a href="/" class="flex items-center gap-3">
				<img src="/logo.webp" alt="Alcoves" width="32" height="32" class="rounded-lg" />
				<span class="text-lg font-bold tracking-tight">Alcoves</span>
			</a>
		</Sidebar.Header>
		<Sidebar.Content>
			<SidebarLibraryNav
				libraries={data.libraries}
				user={data.user}
				currentPath={page.url.pathname}
				librariesError={data.librariesError}
				oncreate={createLibrary}
			/>
		</Sidebar.Content>
	</Sidebar.Root>

	<Sidebar.Inset class="min-h-0 min-w-0 overflow-hidden">
		<!-- relative z-40 gives the header (and its dropdowns) a stacking context
		     above the page content — e.g. the library table's sticky thead (z-30). -->
		<header
			class="relative z-40 flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6"
		>
			<Sidebar.Trigger aria-label="Open sidebar" size="icon-lg" class="md:hidden" />

			<!-- Fills the header on mobile (capped only at md); a plain flex row (no
			     input-group) so there's no vertical divider between icon and input. -->
			<form
				class="min-w-0 flex-1 md:max-w-lg"
				onsubmit={(e) => {
					e.preventDefault();
					submitGlobalSearch();
				}}
			>
				<label
					class="flex items-center rounded-lg bg-muted focus-within:ring-2 focus-within:ring-ring"
				>
					<span class="flex shrink-0 items-center justify-center pr-2.5 pl-3 opacity-60">
						<AppIcon name={ICONS.search} class="size-4" />
					</span>
					<input
						bind:value={globalSearchQuery}
						type="search"
						placeholder="Search everything…"
						aria-label="Search everything"
						class="min-w-0 flex-1 bg-transparent py-2 pr-3 outline-none"
					/>
				</label>
			</form>

			<!-- Desktop-only spacer: pushes the bell/avatar right while the search stays
			     capped. On mobile the spacer is gone so the search can fill the row. -->
			<div class="hidden flex-1 md:block"></div>

			<NotificationBell />

			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="rounded-md p-1 transition-colors hover:bg-accent hover:text-accent-foreground"
					aria-label="User menu"
				>
					<UserAvatar {displayName} avatarUrl={data.user?.avatarUrl ?? null} sizeClass="w-8" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-56">
					<div class="flex items-center gap-2 px-2 py-1.5">
						<UserAvatar {displayName} avatarUrl={data.user?.avatarUrl ?? null} sizeClass="w-7" />
						<span class="min-w-0 flex-1 truncate text-sm font-semibold">{displayName}</span>
					</div>

					<DropdownMenu.Separator />

					<DropdownMenu.Item onSelect={() => goto('/profile')}>
						<AppIcon name={ICONS.user} class="opacity-60" />
						<span>Profile</span>
					</DropdownMenu.Item>

					<DropdownMenu.Item variant="destructive" onSelect={signOut}>
						<AppIcon name={ICONS.signOut} />
						<span>Sign out</span>
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</header>

		<!-- Page content -->
		<main class="min-h-0 flex-1 overflow-hidden">
			<div class="flex h-full flex-col p-4 sm:p-6">
				{@render children()}
			</div>
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>

<!-- App-wide upload progress: pinned bottom-right, persists across navigation. -->
<UploadProgress />
