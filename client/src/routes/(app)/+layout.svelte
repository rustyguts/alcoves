<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { Dialog, Popover } from '@skeletonlabs/skeleton-svelte';
	import { api } from '$lib/api';
	import { auth } from '$lib/state/auth.svelte';
	import { registerLibrariesRefresh } from '$lib/state/libraries-list.svelte';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import SidebarLibraryNav from '$lib/components/SidebarLibraryNav.svelte';
	import NotificationBell from '$lib/components/notifications/NotificationBell.svelte';
	import type { LayoutProps } from './$types';

	/**
	 * Authenticated dashboard shell. Desktop fixed sidebar + a mobile drawer (a
	 * left-anchored Skeleton Dialog), both rendering `SidebarLibraryNav` from
	 * `data.libraries`. The header holds the mobile menu toggle, a global search
	 * form that navigates to `/search?q=…`, the notification bell, and a user menu
	 * popover. Ported faithfully from the Nuxt `dashboard.vue` layout — but reads
	 * the shell data from the `(app)` layout load (`data.user`/`data.libraries`)
	 * instead of refetching, and refreshes via `invalidateAll()`.
	 */
	let { data, children }: LayoutProps = $props();

	let sidebarOpen = $state(false);
	let userMenuOpen = $state(false);

	// Search box: seeded from the URL's `q` and re-synced as navigation changes the
	// query string, yet still user-editable (writable derived) before submit.
	let globalSearchQuery = $derived(page.url.searchParams.get('q') ?? '');

	// Close the mobile drawer whenever the route changes so tapping a sidebar link
	// doesn't leave the overlay covering the page.
	$effect(() => {
		// Read the path so it registers as a dependency, then close the drawer.
		const _path = page.url.pathname;
		void _path;
		sidebarOpen = false;
	});

	// Let any page trigger a sidebar library-list refresh without prop-drilling.
	onMount(() => {
		registerLibrariesRefresh(() => invalidateAll());
	});

	function submitGlobalSearch() {
		const q = globalSearchQuery.trim();
		goto(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
	}

	async function createLibrary() {
		await api.libraries.create({ name: 'Untitled Library' });
		await invalidateAll();
	}

	async function signOut() {
		userMenuOpen = false;
		await auth.logout();
	}

	const displayName = $derived(data.user?.displayName ?? 'User');
</script>

<div class="flex h-screen overflow-hidden bg-surface-50-950">
	<!-- Mobile sidebar drawer -->
	<Dialog open={sidebarOpen} onOpenChange={(e) => (sidebarOpen = e.open)}>
		<Dialog.Backdrop class="fixed inset-0 z-40 bg-surface-950/50 backdrop-blur-sm lg:hidden" />
		<Dialog.Positioner class="fixed inset-y-0 left-0 z-50 flex lg:hidden">
			<Dialog.Content
				class="flex h-full w-72 flex-col border-r border-surface-200-800 preset-filled-surface-50-950"
			>
				<a href="/" class="block px-5 py-4" onclick={() => (sidebarOpen = false)}>
					<div class="flex items-center gap-3">
						<img src="/logo.webp" alt="Alcoves" width="32" height="32" class="rounded-lg" />
						<span class="text-lg font-bold tracking-tight">Alcoves</span>
					</div>
				</a>
				<SidebarLibraryNav
					libraries={data.libraries}
					user={data.user}
					currentPath={page.url.pathname}
					oncreate={createLibrary}
				/>
			</Dialog.Content>
		</Dialog.Positioner>
	</Dialog>

	<!-- Desktop sidebar -->
	<aside
		class="hidden h-full w-64 flex-col overflow-hidden border-r border-surface-200-800 preset-filled-surface-50-950 lg:flex"
	>
		<a href="/" class="block px-5 py-4">
			<div class="flex items-center gap-3">
				<img src="/logo.webp" alt="Alcoves" width="32" height="32" class="rounded-lg" />
				<span class="text-lg font-bold tracking-tight">Alcoves</span>
			</div>
		</a>
		<SidebarLibraryNav
			libraries={data.libraries}
			user={data.user}
			currentPath={page.url.pathname}
			oncreate={createLibrary}
		/>
	</aside>

	<!-- Main column -->
	<div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
		<!-- Header -->
		<!-- relative z-40 gives the header (and its dropdowns) a stacking context
		     above the page content — e.g. the library table's sticky thead (z-30). -->
		<header
			class="relative z-40 flex h-16 shrink-0 items-center gap-3 border-b border-surface-200-800 preset-filled-surface-50-950 px-4 lg:px-6"
		>
			<button
				type="button"
				class="btn-icon preset-tonal lg:hidden"
				aria-label="Open sidebar"
				onclick={() => (sidebarOpen = true)}
			>
				<AppIcon name={ICONS.menu} class="size-5" />
			</button>

			<form
				class="max-w-lg flex-1"
				onsubmit={(e) => {
					e.preventDefault();
					submitGlobalSearch();
				}}
			>
				<label
					class="input-group grid grid-cols-[auto_1fr] rounded-lg preset-filled-surface-100-900"
				>
					<span class="flex items-center justify-center pl-3 opacity-60">
						<AppIcon name={ICONS.search} class="size-4" />
					</span>
					<input
						bind:value={globalSearchQuery}
						type="search"
						placeholder="Search everything…"
						aria-label="Search everything"
						class="bg-transparent px-2 py-2 outline-none"
					/>
				</label>
			</form>

			<div class="flex-1"></div>

			<NotificationBell />

			<Popover
				open={userMenuOpen}
				onOpenChange={(e) => (userMenuOpen = e.open)}
				positioning={{ placement: 'bottom-end' }}
			>
				<Popover.Trigger
					class="rounded-md p-1 transition-colors hover:preset-tonal"
					aria-label="User menu"
				>
					<UserAvatar {displayName} avatarUrl={data.user?.avatarUrl ?? null} sizeClass="w-8" />
				</Popover.Trigger>
				<Popover.Positioner class="z-50">
					<Popover.Content
						class="w-56 space-y-1 card rounded-lg border border-surface-200-800 preset-filled-surface-100-900 p-1 shadow-xl"
					>
						<div class="flex items-center gap-2 px-2.5 py-2">
							<UserAvatar {displayName} avatarUrl={data.user?.avatarUrl ?? null} sizeClass="w-7" />
							<span class="min-w-0 flex-1 truncate text-sm font-semibold">{displayName}</span>
						</div>

						<hr class="my-1 border-surface-200-800" />

						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:preset-tonal"
							onclick={() => {
								userMenuOpen = false;
								goto('/profile');
							}}
						>
							<AppIcon name={ICONS.user} class="size-4 shrink-0 opacity-60" />
							<span>Profile</span>
						</button>

						<button
							type="button"
							class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-error-500 hover:preset-tonal"
							onclick={signOut}
						>
							<AppIcon name={ICONS.signOut} class="size-4 shrink-0" />
							<span>Sign out</span>
						</button>
					</Popover.Content>
				</Popover.Positioner>
			</Popover>
		</header>

		<!-- Page content -->
		<main class="min-h-0 flex-1 overflow-hidden">
			<div class="flex h-full flex-col p-4 sm:p-6">
				{@render children()}
			</div>
		</main>
	</div>
</div>
