<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import { createLibraryTags } from '$lib/state/library-tags.svelte';
	import { TAG_COLOR_PALETTE } from '$lib/shared/tag-colors';
	import { ICONS } from '$lib/utils/icons';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import TagColorPickerDropdown from '$lib/components/library/TagColorPickerDropdown.svelte';
	import type { LibraryEntry, LibraryTag } from '$lib/types/api';

	/**
	 * Flat tag manager for a library: create / rename / recolor / delete tags and
	 * show how many items use each. Ported faithfully from the Nuxt
	 * `pages/libraries/[id]/tags.vue`. The library and its membership come from the
	 * subtree layout load, so we only fetch the tag list + usage counts here.
	 */
	const libraryId = $derived(page.params.id ?? '');

	// The store owns the reactive tag list; the page holds the backing array and
	// hands the store getter/setter access to it (mirrors the old `ref<LibraryTag[]>`).
	let libraryTags = $state<LibraryTag[]>([]);
	const tags = createLibraryTags(
		() => libraryId,
		() => libraryTags,
		(next) => {
			libraryTags = next;
			tags.syncDraftNames();
			seedColorDrafts();
		},
		// The tag manager has no in-memory file list; counts come from a crawl.
		() => []
	);

	let loading = $state(true);
	let loadingUsage = $state(false);
	const tagUsageCounts = $state<Record<string, number>>({});

	const sortedTags = $derived([...libraryTags].sort((a, b) => a.name.localeCompare(b.name)));

	const defaultTagColor = TAG_COLOR_PALETTE[0] ?? '#3B82F6';
	let createTagColor = $state<string>(defaultTagColor);
	let createTagColorDraft = $state<string>(defaultTagColor);
	const tagColorDrafts = $state<Record<string, string>>({});
	let openColorDropdown = $state<string | null>(null);

	function seedColorDrafts() {
		createTagColorDraft = createTagColor;
		for (const tag of libraryTags) {
			tagColorDrafts[tag.id] = tag.color.toUpperCase();
		}
	}

	function closeColorDropdown(event: Event) {
		const trigger = event.target as HTMLElement | null;
		if (trigger?.closest('[data-color-dropdown]')) return;
		openColorDropdown = null;
	}

	function toggleColorDropdown(key: string) {
		openColorDropdown = openColorDropdown === key ? null : key;
	}

	function setUsageCount(tagId: string, count: number) {
		tagUsageCounts[tagId] = count;
	}

	function usageCountFor(tagId: string): number {
		return tagUsageCounts[tagId] ?? 0;
	}

	async function fetchAllEntriesInFolder(folderId: string | null): Promise<LibraryEntry[]> {
		const collected: LibraryEntry[] = [];
		let cursor: string | null = null;

		do {
			const query: { limit: string; folder?: string; cursor?: string } = { limit: '200' };
			if (folderId) {
				query.folder = folderId;
			}
			if (cursor) {
				query.cursor = cursor;
			}

			const result = await api.files.list(libraryId, query);
			collected.push(...(result.entries ?? []));
			cursor = result.nextCursor;
		} while (cursor);

		return collected;
	}

	async function refreshTagUsageCounts() {
		loadingUsage = true;
		try {
			const counts: Record<string, number> = {};
			const folderQueue: Array<string | null> = [null];
			const seenFolderIds = new Set<string>();
			const seenEntryKeys = new Set<string>();

			while (folderQueue.length) {
				const folderId = folderQueue.shift() ?? null;
				const entries = await fetchAllEntriesInFolder(folderId);

				for (const entry of entries) {
					const entryKey = `${entry.kind}:${entry.id}`;
					if (seenEntryKeys.has(entryKey)) {
						continue;
					}
					seenEntryKeys.add(entryKey);

					for (const tag of entry.tags ?? []) {
						counts[tag.id] = (counts[tag.id] ?? 0) + 1;
					}

					if (entry.kind === 'folder' && !seenFolderIds.has(entry.id)) {
						seenFolderIds.add(entry.id);
						folderQueue.push(entry.id);
					}
				}
			}

			for (const key of Object.keys(tagUsageCounts)) {
				delete tagUsageCounts[key];
			}
			for (const tag of libraryTags) {
				setUsageCount(tag.id, counts[tag.id] ?? 0);
			}
		} catch {
			toast.add({ title: 'Failed to load tag usage counts', color: 'error' });
		} finally {
			loadingUsage = false;
		}
	}

	function selectCreateTagColor(color: string) {
		createTagColor = color.toUpperCase();
		createTagColorDraft = createTagColor;
	}

	function normalizeHexColor(value: string): string | null {
		const trimmed = value.trim().toUpperCase();
		if (!trimmed) return null;
		const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
		if (/^#[0-9A-F]{6}$/.test(withHash)) return withHash;
		if (/^#[0-9A-F]{3}$/.test(withHash)) {
			const chars = withHash.slice(1).split('');
			return `#${chars[0]}${chars[0]}${chars[1]}${chars[1]}${chars[2]}${chars[2]}`;
		}
		return null;
	}

	function applyCreateColorDraft() {
		const normalized = normalizeHexColor(createTagColorDraft);
		if (!normalized) {
			toast.add({ title: 'Color must be a valid hex code', color: 'error' });
			createTagColorDraft = createTagColor;
			return;
		}
		createTagColor = normalized;
		createTagColorDraft = normalized;
	}

	async function applyTagColorDraft(tag: LibraryTag) {
		const draft = tagColorDrafts[tag.id] ?? tag.color;
		const normalized = normalizeHexColor(draft);
		if (!normalized) {
			toast.add({ title: 'Color must be a valid hex code', color: 'error' });
			tagColorDrafts[tag.id] = tag.color.toUpperCase();
			return;
		}
		tagColorDrafts[tag.id] = normalized;
		await tags.updateTagColor(tag, normalized);
	}

	async function createTagAndRefresh() {
		const before = new Set(libraryTags.map((tag) => tag.id));
		await tags.createTag(createTagColor);
		for (const tag of libraryTags) {
			if (!before.has(tag.id)) {
				setUsageCount(tag.id, 0);
			}
		}
	}

	async function deleteTagAndRefresh(tagId: string) {
		await tags.deleteTag(tagId);
		delete tagUsageCounts[tagId];
	}

	async function refreshTags() {
		libraryTags = await api.tags.list(libraryId);
		tags.syncDraftNames();
		seedColorDrafts();
	}

	onMount(async () => {
		document.addEventListener('click', closeColorDropdown);
		try {
			await Promise.all([refreshTags(), refreshTagUsageCounts()]);
		} catch {
			toast.add({ title: 'Failed to load tags', color: 'error' });
		} finally {
			loading = false;
		}
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.removeEventListener('click', closeColorDropdown);
		}
	});
</script>

<div class="flex w-full flex-1 flex-col gap-4 overflow-y-auto px-0.5 pb-6">
	<AppPanel
		title="Tags"
		description="Colored labels you attach to files and folders."
		icon={ICONS.tag}
		flush
	>
		<div class="divide-y divide-surface-200-800 overflow-hidden rounded-md bg-surface-50-950">
			<!-- Create row — always present so a tag can be added in any state -->
			<div class="flex items-center gap-2 bg-surface-100-900/40 px-3 py-2.5 sm:gap-3">
				<TagColorPickerDropdown
					keyId="create"
					open={openColorDropdown === 'create'}
					color={createTagColor}
					draft={createTagColorDraft}
					palette={TAG_COLOR_PALETTE}
					title="Choose new tag color"
					ontoggle={() => toggleColorDropdown('create')}
					onpick={selectCreateTagColor}
					onupdateDraft={(value) => (createTagColorDraft = value)}
					oncommitDraft={applyCreateColorDraft}
				/>
				<input
					bind:value={tags.createTagName}
					type="text"
					placeholder="Add a tag"
					aria-label="New tag name"
					class="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm transition placeholder:text-surface-600-400 hover:bg-surface-100-900/70 focus:bg-surface-50-950 focus:outline-none"
					onkeydown={(e) => {
						if (e.key === 'Enter') createTagAndRefresh();
					}}
				/>
				<button
					type="button"
					class="btn preset-filled-primary-500 btn-sm"
					aria-label="Add tag"
					disabled={!tags.createTagName.trim() || tags.creatingTag}
					onclick={createTagAndRefresh}
				>
					{#if tags.creatingTag}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.plus} class="size-4" />
					{/if}
					<span>Add</span>
				</button>
			</div>

			{#if loading}
				<!-- Loading (initial) -->
				<div class="flex items-center gap-2 px-3 py-6 text-sm text-surface-600-400">
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					Loading tags
				</div>
			{:else if !sortedTags.length}
				<!-- Empty -->
				<div class="flex flex-col items-center gap-1.5 px-3 py-12 text-center">
					<AppIcon name={ICONS.tag} class="size-6 text-surface-600-400" />
					<p class="text-sm font-medium">No tags yet</p>
					<p class="text-xs text-surface-600-400">Add your first tag above to start organizing.</p>
				</div>
			{:else}
				<!-- Tag rows -->
				{#each sortedTags as tag (tag.id)}
					<div
						class="group flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-surface-100-900/60 sm:gap-3"
					>
						<TagColorPickerDropdown
							keyId={tag.id}
							open={openColorDropdown === tag.id}
							color={tag.color}
							draft={tagColorDrafts[tag.id] ?? tag.color}
							palette={TAG_COLOR_PALETTE}
							ontoggle={() => toggleColorDropdown(tag.id)}
							onpick={(color) => {
								tags.updateTagColor(tag, color);
								tagColorDrafts[tag.id] = color;
							}}
							onupdateDraft={(value) => (tagColorDrafts[tag.id] = value)}
							oncommitDraft={() => applyTagColorDraft(tag)}
						/>

						<div class="group/name relative min-w-0 flex-1">
							<input
								bind:value={tags.tagDraftNames[tag.id]}
								type="text"
								aria-label={`Rename tag ${tag.name}`}
								class="w-full truncate rounded-md bg-transparent py-1 pr-7 pl-1.5 text-sm font-medium transition hover:bg-surface-100-900/70 focus:bg-surface-50-950 focus:outline-none"
								onblur={() => tags.saveDraftTagName(tag)}
								onkeydown={(e) => {
									if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
								}}
							/>
							<AppIcon
								name={ICONS.edit}
								class="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-surface-600-400 opacity-0 transition-opacity group-focus-within/name:opacity-0 group-hover/name:opacity-100"
							/>
						</div>

						<span class="w-20 shrink-0 text-right text-xs text-surface-600-400 tabular-nums">
							{#if loadingUsage}
								<AppIcon name={ICONS.loading} class="inline size-3 animate-spin" />
							{:else}
								{usageCountFor(tag.id)}
								{usageCountFor(tag.id) === 1 ? 'item' : 'items'}
							{/if}
						</span>

						<button
							type="button"
							class="btn-icon btn-icon-sm shrink-0 preset-tonal-error opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
							aria-label={`Delete tag ${tag.name}`}
							onclick={() => deleteTagAndRefresh(tag.id)}
						>
							<AppIcon name={ICONS.trash} class="size-4" />
						</button>
					</div>
				{/each}
			{/if}
		</div>
	</AppPanel>
</div>
