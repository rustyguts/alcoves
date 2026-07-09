import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import ShadcnSmokeHarness from './ShadcnSmokeHarness.svelte';

/**
 * F28 rework: `shadcn-smoke.svelte.test.ts` claimed to catch "SSR/runes
 * breakage" but is a `*.svelte.test.ts` file, so it only ever runs in the
 * chromium browser project (window/document/localStorage all exist there) —
 * zero SSR execution of the vendored primitive set. This is the real SSR
 * net: it's a plain `*.test.ts` file (routed to the `server`/node vitest
 * project, which — via vite-node's SSR-mode module transform — compiles
 * `.svelte` imports in "server" generate mode, same as SvelteKit's actual
 * SSR), and server-renders the same composed harness with `svelte/server`'s
 * `render()`. No DOM/browser globals exist in this project, so any
 * module-scope or top-level `window`/`document`/`localStorage` access in a
 * vendored primitive throws here exactly as it would crash a real page's
 * SSR — the failure class named in the rewrite's hard constraints
 * (.agents/specs/shadcn-rewrite/00-master-plan.md: "Top-level browser API
 * access crashes the server render").
 */
describe('shadcn-svelte vendored primitives SSR smoke test', () => {
	it('server-renders the full composed harness without throwing', () => {
		const { body } = render(ShadcnSmokeHarness);
		expect(body).toContain('shadcn-smoke-harness');
		// Spot-check a few non-portalled primitives actually emitted their
		// expected markup. bits-ui's portal-based primitives (Dialog/
		// AlertDialog/Sheet/Popover/Tooltip/DropdownMenu/ContextMenu/
		// Select.Content) render NOTHING server-side — verified empirically —
		// since there is no `document.body` to portal into yet; that's
		// expected bits-ui behavior (their Content still mounts fine
		// client-side, exercised by the browser-project smoke test and e2e),
		// not something this SSR test should assert on.
		expect(body).toContain('Card title');
		expect(body).toContain('Command item');
		expect(body).toContain('Tab A content');
		expect(body).toContain('Nothing here');
	});
});
