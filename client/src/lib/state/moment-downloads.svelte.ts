import { browser } from '$app/environment';
import { api } from '$lib/api';
import { toast } from '$lib/state/toast';
import type { Moment } from '$lib/types/api';

function isMomentReady(m: Moment): boolean {
	return m.exportStatus === 'ready' && m.exportedVersion === m.exportVersion;
}

export interface MomentDownloadsOptions {
	/** Reactive library id (was a `Ref<string>` in the Vue composable). */
	getLibraryId: () => string;
	/** Reactive file id (was a `Ref<string>` in the Vue composable). */
	getFileId: () => string;
	/** Reactive moments list the consumer keeps; read inside `sync()`. */
	getMoments: () => Moment[];
	/**
	 * Kicks off a moment export. The Vue version received this as a callback so the
	 * caller could refresh its own moments list afterwards; kept injectable here.
	 * Defaults to `api.moments.export`.
	 */
	triggerExport?: (momentId: string) => Promise<unknown>;
	/**
	 * Performs the actual browser redirect to a download URL. Injectable so the
	 * store stays node-testable; defaults to assigning `window.location.href`.
	 */
	navigate?: (url: string) => void;
}

/**
 * "Download when ready" queue: callers ask for a moment download; if the export
 * is fresh we redirect immediately, otherwise we trigger an export and wait —
 * once the moment lands as ready we redirect to the file.
 *
 * Ported from the Nuxt `useMomentDownloads` composable. The Vue version used a
 * `watch(moments, …)` to react to the moments list; runes/`$effect` are kept out
 * of the store so it is unit-testable, so the consuming component instead calls
 * `sync()` from its own `$effect` whenever the moments list changes.
 */
export function createMomentDownloads(opts: MomentDownloadsOptions) {
	const triggerExport =
		opts.triggerExport ??
		((momentId: string) => api.moments.export(opts.getLibraryId(), opts.getFileId(), momentId));
	const navigate =
		opts.navigate ??
		((url: string) => {
			if (browser) window.location.href = url;
		});

	let pendingIds = $state<Set<string>>(new Set());

	function isPending(id: string): boolean {
		return pendingIds.has(id);
	}

	function navigateToDownload(momentId: string) {
		navigate(api.moments.downloadUrl(opts.getLibraryId(), opts.getFileId(), momentId));
	}

	async function request(momentId: string) {
		const m = opts.getMoments().find((x) => x.id === momentId);
		if (!m) return;
		if (isMomentReady(m)) {
			navigateToDownload(momentId);
			return;
		}
		pendingIds = new Set([...pendingIds, momentId]);
		try {
			await triggerExport(momentId);
			toast.add({ title: 'Processing clip…', color: 'info' });
		} catch {
			const next = new Set(pendingIds);
			next.delete(momentId);
			pendingIds = next;
			toast.add({ title: 'Failed to start export', color: 'error' });
		}
	}

	/**
	 * Reconciles the pending queue against the latest moments list. The consumer
	 * calls this from an `$effect` that tracks its moments. Mirrors the Vue
	 * `watch(moments, …, { deep: true })`: redirects on ready, drops vanished
	 * moments, and toasts + drops failed ones.
	 */
	function sync() {
		if (pendingIds.size === 0) return;
		const list = opts.getMoments();
		const next = new Set(pendingIds);
		let changed = false;
		for (const id of pendingIds) {
			const m = list.find((x) => x.id === id);
			if (!m) {
				next.delete(id);
				changed = true;
				continue;
			}
			if (isMomentReady(m)) {
				next.delete(id);
				changed = true;
				navigateToDownload(id);
			} else if (m.exportStatus === 'failed') {
				next.delete(id);
				changed = true;
				toast.add({ title: 'Export failed', color: 'error' });
			}
		}
		if (changed) pendingIds = next;
	}

	return {
		get pendingIds() {
			return pendingIds;
		},
		isPending,
		request,
		sync
	};
}
