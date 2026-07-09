import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import ShadcnSmokeHarness from './ShadcnSmokeHarness.svelte';
import { Button } from './button/index.js';
import { Badge } from './badge/index.js';
import { Input } from './input/index.js';
import { Textarea } from './textarea/index.js';
import { Label } from './label/index.js';
import { Skeleton } from './skeleton/index.js';
import { Switch } from './switch/index.js';
import { Checkbox } from './checkbox/index.js';
import { Progress } from './progress/index.js';
import { Spinner } from './spinner/index.js';
import { Toggle } from './toggle/index.js';

/**
 * shadcn-svelte vendored primitives are excluded from the coverage gates
 * (vite.config.ts / scripts/coverage-floor.mjs — upstream-maintained,
 * exercised via composite tests + e2e). This smoke test is the cheap
 * regression net for the vendored set itself: it asserts every top-level
 * primitive mounts and runs its runes under Svelte 5 without throwing,
 * catching client-side breakage the moment a registry update lands, without
 * needing a bespoke test per component.
 *
 * F28 rework: this is a `*.svelte.test.ts` file, so it only ever runs in the
 * chromium browser project — window/document/localStorage all exist here,
 * so it does NOT catch SSR breakage (a component that only crashes when
 * `window`/`document`/`localStorage` are accessed at module scope or during
 * initial render would pass this file cleanly). For that, see the sibling
 * `shadcn-smoke-ssr.test.ts`, which server-renders the same harness via
 * `svelte/server`'s `render()` in the node project (no DOM globals).
 */
describe('shadcn-svelte vendored primitives smoke test', () => {
	it('mounts a full composed tree of every vendored primitive without throwing', async () => {
		const screen = render(ShadcnSmokeHarness);
		await tick();
		await expect.element(screen.getByTestId('shadcn-smoke-harness')).toBeInTheDocument();

		// Spot-check a few primitives actually rendered their expected content,
		// including portal-rendered (Dialog/Popover/Tooltip/DropdownMenu/Select)
		// content mounted to document.body rather than the harness container.
		await expect.element(screen.getByText('Card title')).toBeInTheDocument();
		await expect.element(screen.getByText('Dialog title')).toBeInTheDocument();
		await expect.element(screen.getByText('Command item')).toBeInTheDocument();
	});

	// Standalone primitives that take no required composition — mounted
	// individually in a loop as the cheapest possible per-component check.
	const standalone: Array<[string, unknown, Record<string, unknown>]> = [
		['Button', Button, { children: undefined }],
		['Badge', Badge, {}],
		['Input', Input, {}],
		['Textarea', Textarea, {}],
		['Label', Label, {}],
		['Skeleton', Skeleton, {}],
		['Switch', Switch, {}],
		['Checkbox', Checkbox, {}],
		['Progress', Progress, { value: 30 }],
		['Spinner', Spinner, {}],
		['Toggle', Toggle, { children: undefined }]
	];

	for (const [name, Component, props] of standalone) {
		it(`mounts ${name} standalone without throwing`, async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const screen = render(Component as any, { props });
			await tick();
			expect(screen.container).toBeTruthy();
		});
	}
});
