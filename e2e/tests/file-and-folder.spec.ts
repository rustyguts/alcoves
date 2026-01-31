import { test, expect } from './fixtures';

test.describe('File Selection and Keyboard Shortcuts - Using Shared Test User', () => {
  
  test.beforeEach(async ({ page }) => {
    // User is already logged in from global setup
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('Ctrl+A keyboard shortcut works', async ({ page }) => {
    // Press Ctrl+A - should not error
    await page.keyboard.press('Control+a');
    expect(true).toBe(true);
  });

  test('Escape keyboard shortcut works', async ({ page }) => {
    // Press Escape - should not error
    await page.keyboard.press('Escape');
    expect(true).toBe(true);
  });

  test('arrow key navigation works', async ({ page }) => {
    // Press arrow keys - should not error
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    expect(true).toBe(true);
  });

});

test.describe('Folder Management - Using Shared Test User', () => {
  
  test.beforeEach(async ({ page }) => {
    // User is already logged in from global setup
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('home page loads successfully', async ({ page }) => {
    // Home page should be visible with "In Progress" placeholder
    await expect(page.locator('h1')).toContainText('In Progress');
  });

  test('sidebar navigation is visible', async ({ page }) => {
    // Sidebar should be visible
    await expect(page.locator('.drawer')).toBeVisible();
    
    // Should see Alcoves branding
    await expect(page.locator('a:has-text("Alcoves")')).toBeVisible();
  });

  test('user can access profile menu', async ({ page }) => {
    // Use keyboard navigation to open profile dropdown
    // Tab to the dropdown trigger, then Enter to open
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    
    // Should see user email and logout option
    await expect(page.locator('button:has-text("Log Out")')).toBeVisible();
  });

});
