import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

// SSR-rendered routes (/s/** share pages) fetch their metadata server-side from
// the Nitro server, so Playwright's page.route() mocks can't intercept them.
// Point the dev server's backend at a tiny deterministic mock backend instead.
const MOCK_BACKEND_PORT = 3099;
const MOCK_BACKEND_URL = `http://127.0.0.1:${MOCK_BACKEND_PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: isCI ? 2 : 3,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
  },
  webServer: [
    {
      command: "node test/e2e/helpers/mock-backend.mjs",
      url: `${MOCK_BACKEND_URL}/api/health`,
      env: { MOCK_BACKEND_PORT: String(MOCK_BACKEND_PORT) },
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      command: "bun run dev --port 4173 --host 127.0.0.1",
      url: "http://127.0.0.1:4173",
      env: { ALCOVES_API_URL: MOCK_BACKEND_URL },
      reuseExistingServer: !isCI,
      timeout: 240_000,
    },
  ],
});
