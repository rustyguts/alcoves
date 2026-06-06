import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack e2e: these tests run against a REAL running Alcoves stack — the Go
 * API + Postgres + Dragonfly (seeded) behind the SvelteKit server — NOT a mock.
 *
 * By default Playwright builds and runs the PRODUCTION SvelteKit server (adapter-
 * node, deterministic — no vite-dev on-demand compile) on :4173, pointed at the
 * Go API via INTERNAL_API_URL (default the docker-compose backend at :3001). Set
 * E2E_BASE_URL to instead run against an already-running server (then no webServer).
 *
 * Local:  `docker compose up` (seeds the DB), then `bun run test:e2e`.
 * Seed login: test@alcoves.io / password123 (see backend/internal/seed).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const internalApiUrl = process.env.INTERNAL_API_URL ?? 'http://localhost:3001';

export default defineConfig({
	testDir: './test/e2e',
	testMatch: '**/*.e2e.{ts,js}',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	timeout: 30_000,
	expect: { timeout: 10_000 },
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: 'bun run build && node build',
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
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
		}
	]
});
