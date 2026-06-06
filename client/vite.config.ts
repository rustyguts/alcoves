import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

// SvelteKit's `$env/dynamic/public` virtual module isn't initialized in vitest
// browser mode; alias it to a stub so component tests (which transitively import
// apiUrl/url.ts) load. Tests needing a value mock `$lib/api` directly.
const envPublicStub = fileURLToPath(new URL('./vitest/env-public-stub.ts', import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{js,ts,svelte}'],
			exclude: [
				'src/**/*.{test,spec}.{js,ts}',
				'src/**/*.d.ts',
				'src/app.d.ts',
				'src/lib/types/**',
				// Test-fixture mock components co-located with route tests.
				'src/**/*Mock*.svelte',
				// Thin wrappers around heavy browser-only libs whose onMount dynamic
				// imports can't run in unit tests; exercised by the full-stack e2e.
				'src/lib/components/LibraryMap.svelte',
				'src/lib/components/editor/VideoEditorPlayer.svelte',
				// Pure 2-line passthroughs that render the (92%-covered) LibraryBrowser;
				// the v8/Svelte artifact on such tiny files isn't a real coverage gap.
				// (`*` segments avoid the glob metachars in the (app)/[id] dir names.)
				'**/libraries/*/+page.svelte',
				'**/libraries/*/trash/+page.svelte'
			],
			reporter: ['text', 'html', 'lcov', 'json-summary'],
			// Headline metrics gated at 90% (the "≥90% coverage" bar). Branch coverage
			// of UI conditionals is a stricter secondary metric, gated at 80%. Per-file
			// floor (60%) is enforced by scripts/coverage-floor.mjs.
			thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 }
		},
		projects: [
			{
				extends: './vite.config.ts',
				resolve: { alias: { '$env/dynamic/public': envPublicStub } },
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
