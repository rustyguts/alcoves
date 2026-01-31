import { test, expect } from './fixtures';

test.describe('Library View Toggle - Using Shared Test User', () => {
  
  test.beforeEach(async ({ page }) => {
    // User is already logged in from global setup
    await page.goto('/');
    
    // Wait for page to load
    await expect(page.locator('h1')).toBeVisible();
  });

  test('home page shows content for authenticated users', async ({ page }) => {
    // Home page should be visible
    await expect(page.locator('h1')).toContainText('In Progress');
    
    // Should see the main layout
    await expect(page.locator('body')).toBeVisible();
  });

  test('sidebar is visible with navigation', async ({ page }) => {
    // Sidebar with Alcoves logo should be visible (use specific selector to avoid matching email)
    await expect(page.locator('a:has-text("Alcoves")')).toBeVisible();
    
    // Should have menu (use first() to avoid matching multiple menu elements)
    await expect(page.locator('.menu').first()).toBeVisible();
  });

  test('profile dropdown works', async ({ page }) => {
    // Use keyboard navigation to open profile dropdown
    // Tab to the dropdown trigger, then Enter to open
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    
    // Should see logout option
    await expect(page.locator('button:has-text("Log Out")')).toBeVisible();
  });

  test('theme selector is available', async ({ page }) => {
    // Use keyboard navigation to open profile dropdown
    // Tab to the dropdown trigger, then Enter to open
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    
    // Should see theme options
    await expect(page.locator('text=Theme')).toBeVisible();
  });

  test('libraries section exists in sidebar', async ({ page }) => {
    // Should see Libraries header in sidebar
    await expect(page.locator('text=Libraries')).toBeVisible();
    
    // Should have Create Library button
    await expect(page.locator('button:has-text("Create Library")')).toBeVisible();
  });

});
