import type { Action } from 'svelte/action';

/**
 * Move an element into a target container (by CSS selector) — the SvelteKit
 * equivalent of the Nuxt `<Teleport>`. Library pages render their toolbar with
 * `use:portal={'#library-header-actions'}` so it lands in the library header's
 * breadcrumb row. Actions never run during SSR, so no browser guard is needed.
 * No-ops (the node stays in place) when the target isn't found.
 *
 * The target is a single, persistent slot shared by sibling library tabs (Files,
 * Tags, Objects), so the move is made IDEMPOTENT — it only appends when the node
 * isn't already the target's child. Without this, a reactive `update` (or a
 * navigation that re-runs the action before `destroy` fires) re-appended the same
 * node and the toolbar appeared twice in the header.
 */
export const portal: Action<HTMLElement, string> = (node, target) => {
	function move(selector: string) {
		const dest = document.querySelector(selector);
		if (dest && node.parentElement !== dest) {
			dest.appendChild(node);
		}
	}

	move(target);

	return {
		update(selector: string) {
			move(selector);
		},
		destroy() {
			node.remove();
		}
	};
};
