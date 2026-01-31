import { test, expect, TEST_USER } from './fixtures';

/**
 * Tests that verify authenticated state - use the shared storage state.
 * These must NOT call logout or otherwise invalidate the shared session.
 */
test.describe('Authenticated State - Using Shared Test User', () => {

  test('starts already authenticated via global setup', async ({ page }) => {
    await page.goto('/');

    // Authenticated users see the home page, not redirected to login
    await expect(page).toHaveURL('/');
    await expect(page.locator('h1')).toContainText('In Progress');
  });

  test('authenticated user is redirected away from login page', async ({ page }) => {
    // The app redirects authenticated users from /login to /
    await page.goto('/login');
    await expect(page).toHaveURL('/');
  });

});

/**
 * Auth flow tests - use a fresh browser context with NO shared storage state.
 * This prevents these tests from invalidating the shared session used by other tests.
 */
test.describe('Auth Flow Tests - Fresh Context', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('user can login and logout', async ({ page }) => {
    // Start unauthenticated on login page
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('Alcoves');

    // Login
    await page.locator('input[name="email"]').fill(TEST_USER.email);
    await page.locator('input[name="password"]').fill(TEST_USER.password);
    await page.locator('button[type="submit"]').click();

    // Should be redirected to home
    await page.waitForURL('/', { timeout: 5000 });
    await expect(page.locator('h1')).toContainText('In Progress');

    // Logout via API
    await page.context().request.post('http://localhost:8080/logout');
    await page.goto('/login');

    // Should see login page
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
  });

  test('user cannot login with wrong password', async ({ page }) => {
    await page.goto('/login');

    // Try to login with wrong password
    await page.locator('input[name="email"]').fill(TEST_USER.email);
    await page.locator('input[name="password"]').fill('WrongPassword123!');
    await page.locator('button[type="submit"]').click();

    // Should stay on login page
    await expect(page).toHaveURL('/login');
  });

  test('login page has link to register', async ({ page }) => {
    await page.goto('/login');

    // Check for register link
    const registerLink = page.locator('a:has-text("Create one")');
    await expect(registerLink).toBeVisible();

    // Click link
    await registerLink.click();

    // Should navigate to register page
    await expect(page).toHaveURL('/register');
    await expect(page.locator('p:has-text("Create your account")')).toBeVisible();
  });

  test('register page has link to login', async ({ page }) => {
    await page.goto('/register');

    // Check for login link
    const loginLink = page.locator('a:has-text("Sign in")');
    await expect(loginLink).toBeVisible();

    // Click link
    await loginLink.click();

    // Should navigate to login page
    await expect(page).toHaveURL('/login');
    await expect(page.locator('p:has-text("Welcome back")')).toBeVisible();
  });

  test('registration form shows validation errors', async ({ page }) => {
    await page.goto('/register');

    // Submit empty form
    await page.locator('button[type="submit"]').click();

    // Should stay on register page (HTML5 validation prevents submission)
    await expect(page).toHaveURL('/register');

    // Inputs should still be visible
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
  });

});
