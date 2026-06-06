import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack e2e + visual regression. Tests run against a REAL running Alcoves
 * stack — the Go API + Postgres + Dragonfly (seeded) behind the SvelteKit server.
 *
 * By default Playwright builds and runs the PRODUCTION SvelteKit server under Bun
 * on :4173, pointed at the Go API via INTERNAL_API_URL (default the docker-compose
 * backend at :3001). Set E2E_BASE_URL to run against an already-running server
 * (then no webServer) — this is how the deterministic visual baselines are made
 * (inside the pinned Playwright container, see scripts/screenshots.sh).
 *
 * Two test surfaces:
 * - Functional flows: `*.e2e.ts` (excluding `*.screenshots.e2e.ts`), project `chromium`.
 * - Visual regression: `*.screenshots.e2e.ts`, projects desktop/mobile × light/dark.
 *
 * Local:  `docker compose up` (seeds the DB), then `bun run test:e2e`.
 * Visual: `bun run test:e2e:screenshots` (compare) / `:update` (regenerate baselines).
 * Seed login: test@alcoves.io / password123 (see backend/internal/seed).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const internalApiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

// Saved once by the `setup` project; reused by every visual project so login
// happens a single time instead of per screenshot.
const STORAGE_STATE = 'test/e2e/.auth/state.json';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

type Theme = 'light' | 'dark';

function visualProject(label: string, viewport: { width: number; height: number }, theme: Theme) {
	return {
		name: `${label}-${theme}`,
		testMatch: '**/*.screenshots.e2e.ts',
		dependencies: ['setup'],
		use: {
			...devices['Desktop Chrome'],
			viewport,
			colorScheme: theme,
			storageState: STORAGE_STATE
		},
		metadata: { theme }
	};
}

export default defineConfig({
	testDir: './test/e2e',
	testMatch: '**/*.e2e.{ts,js}',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	timeout: 60_000,
	expect: {
		timeout: 10_000,
		toHaveScreenshot: {
			animations: 'disabled',
			caret: 'hide',
			scale: 'css',
			// Absorb sub-pixel antialiasing noise; layout breaks move far more pixels.
			maxDiffPixelRatio: 0.01
		}
	},
	// Baselines are platform-agnostic on purpose — they're always generated and
	// compared inside the pinned Playwright container (scripts/screenshots.sh).
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}-{projectName}{ext}',
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: 'bun run build && bun ./build/index.js',
				port: 4173,
				reuseExistingServer: !process.env.CI,
				timeout: 180_000,
				env: { FRONTEND_PORT: '4173', INTERNAL_API_URL: internalApiUrl }
			},
	use: {
		baseURL,
		trace: 'on-first-retry',
		locale: 'en-US',
		timezoneId: 'UTC'
	},
	projects: [
		{ name: 'setup', testMatch: /.*\.setup\.ts/ },
		{
			name: 'chromium',
			testMatch: '**/*.e2e.ts',
			testIgnore: '**/*.screenshots.e2e.ts',
			use: { ...devices['Desktop Chrome'], viewport: DESKTOP }
		},
		visualProject('desktop', DESKTOP, 'light'),
		visualProject('desktop', DESKTOP, 'dark'),
		visualProject('mobile', MOBILE, 'light'),
		visualProject('mobile', MOBILE, 'dark')
	]
});
