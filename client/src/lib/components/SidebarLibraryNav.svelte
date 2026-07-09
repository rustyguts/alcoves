<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import LibrarySwitcher from '$lib/components/LibrarySwitcher.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { ICONS } from '$lib/utils/icons';
	import type { AuthUser, Library } from '$lib/types/api';

	/**
	 * The sidebar library region: a library switcher (account-switcher style) at
	 * the top, then a divider, then the current library's actions/sections (Files,
	 * Timeline, Map, Tags, Feed, People, Settings, Trash) as a static nav. Objects
	 * is an advanced owner feature reached from the library Settings page, not
	 * here. The actions always target the active library (or the default library
	 * when no library is open). Rendered once inside `Sidebar.Content` — the
	 * `Sidebar.Root` primitive itself swaps between the fixed desktop panel and
	 * the mobile Sheet, so this markup is shared between both automatically. The
	 * active link is derived from `currentPath` so this component stays free of
	 * `$app/state` and is trivially testable.
	 */
	interface Props {
		libraries: Library[] | null;
		user: AuthUser | null;
		/** Current route path, e.g. `/libraries/abc/timeline`. */
		currentPath?: string;
		/** The shell's libraries fetch failed (distinct from "no libraries"). */
		librariesError?: boolean;
		oncreate?: () => void;
	}

	interface NavItem {
		key: string;
		label: string;
		icon: string;
		to: string;
		active: boolean;
	}

	let { libraries, user, currentPath = '', librariesError = false, oncreate }: Props = $props();

	function libBase(id: string): string {
		return `/libraries/${id}`;
	}

	function isActiveLibrary(id: string): boolean {
		const base = libBase(id);
		return currentPath === base || currentPath.startsWith(`${base}/`);
	}

	// The library whose actions the sidebar shows: the one open in the route, else
	// the default library, else the first available.
	const currentLibrary = $derived.by<Library | null>(() => {
		const libs = libraries ?? [];
		return (
			libs.find((l) => isActiveLibrary(l.id)) ?? libs.find((l) => l.isDefault) ?? libs[0] ?? null
		);
	});

	function activeTabKey(id: string): string | null {
		if (!isActiveLibrary(id)) return null;
		const p = currentPath;
		if (p.endsWith('/timeline')) return 'timeline';
		if (p.endsWith('/map')) return 'map';
		if (p.endsWith('/tags')) return 'tags';
		if (p.endsWith('/feed')) return 'feed';
		if (p.includes(`${libBase(id)}/people`)) return 'people';
		if (p.endsWith('/objects')) return 'objects';
		if (p.endsWith('/settings')) return 'settings';
		if (p.endsWith('/trash')) return 'trash';
		return 'files';
	}

	function canManage(l: Library): boolean {
		if (l.ownerId && user?.id && l.ownerId === user.id) return true;
		return l.currentUserRole === 'owner' || l.currentUserRole === 'admin';
	}

	const actionItems = $derived.by<NavItem[]>(() => {
		const l = currentLibrary;
		if (!l) return [];
		const base = libBase(l.id);
		const active = activeTabKey(l.id);

		const items: NavItem[] = [
			{ key: 'files', label: 'Files', icon: ICONS.folder, to: base, active: active === 'files' },
			{
				key: 'timeline',
				label: 'Timeline',
				icon: ICONS.timeline,
				to: `${base}/timeline`,
				active: active === 'timeline'
			},
			{
				key: 'map',
				label: 'Map',
				icon: ICONS.location,
				to: `${base}/map`,
				active: active === 'map'
			},
			{
				key: 'tags',
				label: 'Tags',
				icon: ICONS.tag,
				to: `${base}/tags`,
				active: active === 'tags'
			},
			{
				key: 'feed',
				label: 'Feed',
				icon: ICONS.feed,
				to: `${base}/feed`,
				active: active === 'feed'
			}
		];

		if (l.faceRecognitionEnabled) {
			items.push({
				key: 'people',
				label: 'People',
				icon: ICONS.people,
				to: `${base}/people`,
				active: active === 'people'
			});
		}

		if (canManage(l)) {
			items.push({
				key: 'settings',
				label: 'Settings',
				icon: ICONS.settings,
				to: `${base}/settings`,
				active: active === 'settings'
			});
		}

		items.push({
			key: 'trash',
			label: 'Trash',
			icon: ICONS.trash,
			to: `${base}/trash`,
			active: active === 'trash'
		});

		return items;
	});

	const bottomItems = $derived.by<NavItem[]>(() => {
		if (user?.role !== 'owner') return [];
		return [
			{
				key: 'admin',
				label: 'Admin',
				icon: ICONS.admin,
				to: '/admin',
				active: currentPath === '/admin' || currentPath.startsWith('/admin/')
			}
		];
	});

	// Close the mobile drawer (Sheet) whenever the active section changes, so
	// tapping a link doesn't leave the sheet covering the new page.
	// `useSidebar()` resolves to `undefined` outside a `Sidebar.Provider` — e.g.
	// this component's isolated unit tests — where the close is simply a no-op.
	//
	// This component only mounts while the mobile Sheet is open (bits-ui
	// unmounts its content entirely while closed), so the effect's first run —
	// on mount, with whatever `currentPath` the drawer was opened on — must be
	// skipped, or every open would immediately self-close.
	const sidebar = Sidebar.useSidebar();
	let mounted = false;
	$effect(() => {
		// Read currentPath so it registers as a dependency, then close the drawer.
		void currentPath;
		if (!mounted) {
			mounted = true;
			return;
		}
		sidebar?.setOpenMobile(false);
	});
</script>

{#snippet navItem(item: NavItem)}
	<Sidebar.MenuItem>
		<Sidebar.MenuButton isActive={item.active} size="lg">
			{#snippet child({ props })}
				<a href={item.to} aria-current={item.active ? 'page' : undefined} {...props}>
					<AppIcon name={item.icon} />
					<span class="min-w-0 flex-1 truncate">{item.label}</span>
				</a>
			{/snippet}
		</Sidebar.MenuButton>
	</Sidebar.MenuItem>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	<div class="px-2 pt-1">
		<LibrarySwitcher
			{libraries}
			currentLibraryId={currentLibrary?.id ?? null}
			oncreate={() => oncreate?.()}
		/>
	</div>

	<Sidebar.Separator class="my-2" />

	{#if librariesError && !currentLibrary}
		<div
			class="mx-2 mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			<AppIcon name={ICONS.warning} class="size-4 shrink-0" />
			<span>Couldn't load your libraries. Refresh to try again.</span>
		</div>
	{/if}

	<div class="flex-1 overflow-y-auto px-2">
		<nav aria-label="Library sections">
			<Sidebar.Menu>
				{#each actionItems as item (item.key)}
					{@render navItem(item)}
				{/each}
			</Sidebar.Menu>
		</nav>
	</div>

	{#if bottomItems.length}
		<div class="mt-auto px-2 pb-3">
			<Sidebar.Separator class="mb-2" />
			<nav aria-label="Admin">
				<Sidebar.Menu>
					{#each bottomItems as item (item.key)}
						{@render navItem(item)}
					{/each}
				</Sidebar.Menu>
			</nav>
		</div>
	{/if}
</div>
