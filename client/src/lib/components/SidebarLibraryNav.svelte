<script lang="ts">
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import LibrarySwitcher from '$lib/components/LibrarySwitcher.svelte';
	import { ICONS } from '$lib/utils/icons';
	import type { AuthUser, Library } from '$lib/types/api';

	/**
	 * The sidebar library region: a library switcher (account-switcher style) at
	 * the top, then a divider, then the current library's actions/sections (Files,
	 * Timeline, Map, Tags, Feed, People, Settings, Trash) as a static nav. Objects
	 * is an advanced owner feature reached from the library Settings page, not
	 * here. The actions always target the active library (or the default library
	 * when no library is open). Shared between the desktop sidebar and the mobile
	 * slideover. The active link is derived from `currentPath` so this component
	 * stays free of `$app/state` and is trivially testable.
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
</script>

{#snippet navLink(item: NavItem)}
	<a
		href={item.to}
		aria-current={item.active ? 'page' : undefined}
		class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-base transition-colors
			{item.active ? 'preset-filled-primary-500' : 'hover:preset-tonal'}"
	>
		<AppIcon name={item.icon} class="size-5 shrink-0" />
		<span class="min-w-0 flex-1 truncate">{item.label}</span>
	</a>
{/snippet}

<div class="flex min-h-0 flex-col">
	<div class="px-2 pt-1">
		<LibrarySwitcher
			{libraries}
			currentLibraryId={currentLibrary?.id ?? null}
			oncreate={() => oncreate?.()}
		/>
	</div>

	<hr class="my-2 border-surface-200-800" />

	{#if librariesError && !currentLibrary}
		<div
			class="mx-2 mb-2 flex items-start gap-2 rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-xs text-error-600"
		>
			<AppIcon name={ICONS.warning} class="size-4 shrink-0" />
			<span>Couldn't load your libraries. Refresh to try again.</span>
		</div>
	{/if}

	<div class="flex-1 overflow-y-auto px-2">
		<nav aria-label="Library sections" class="flex w-full flex-col gap-1">
			{#each actionItems as item (item.key)}
				{@render navLink(item)}
			{/each}
		</nav>
	</div>

	{#if bottomItems.length}
		<div class="mt-auto px-2 pb-3">
			<hr class="mb-2 border-surface-200-800" />
			<nav aria-label="Admin" class="flex w-full flex-col gap-1">
				{#each bottomItems as item (item.key)}
					{@render navLink(item)}
				{/each}
			</nav>
		</div>
	{/if}
</div>
