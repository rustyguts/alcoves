import { test as setup } from '@playwright/test';
import { login } from './helpers/auth';

/**
 * One-time auth for the visual projects: log in through the real form once and
 * persist the session so every screenshot project starts authenticated without
 * re-running the login flow. Path mirrors `storageState` in playwright.config.ts.
 */
const STORAGE_STATE = 'test/e2e/.auth/state.json';

setup('authenticate', async ({ page }) => {
	await login(page);
	await page.context().storageState({ path: STORAGE_STATE });
});
