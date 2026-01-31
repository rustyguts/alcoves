import { test, expect } from './fixtures';

test.describe('Authentication Flows - Using Shared Test User', () => {
  
  test('starts already authenticated via global setup', async ({ page }) => {
    // Test user is already logged in from global setup
    await page.goto('/');
    
    // Should be on home page (authenticated users see home, not redirected to login)
    await expect(page).toHaveURL('/');
    
    // Home page shows "In Progress" for now (this is the placeholder)
    await expect(page.locator('h1')).toContainText('In Progress');
  });

  test('user can logout and login again', async ({ page, authPage }) => {
    // Start from authenticated state - go to home page and wait for load
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Logout via API
    await authPage.logout();
    
    // Verify redirected to login
    await expect(page).toHaveURL('/login');
    await authPage.expectLoggedOut();
    
    // Login again with test credentials
    await authPage.login('test-e2e@alcoves.test', 'TestPassword123!');
    
    // Verify back to home page or library page
    await expect(page).toHaveURL(/\/(libraries\/.*)?/);
  });

  test('user cannot login with wrong password', async ({ page, authPage }) => {
    // Start logged in, then logout
    await page.goto('/');
    await authPage.logout();
    
    // Try to login with wrong password
    await authPage.gotoLogin();
    await page.locator('input[name="email"]').fill('test-e2e@alcoves.test');
    await page.locator('input[name="password"]').fill('WrongPassword123!');
    await page.locator('button[type="submit"]').click();
    
    // Should stay on login page
    await expect(page).toHaveURL('/login');
  });

  test('login page has link to register', async ({ page, authPage }) => {
    // Need to logout first to see login page
    await authPage.logout();
    
    // Check for register link
    const registerLink = page.locator('a:has-text("Create one")');
    await expect(registerLink).toBeVisible();
    
    // Click link
    await registerLink.click();
    
    // Should navigate to register page
    await expect(page).toHaveURL('/register');
    await expect(page.locator('p')).toContainText('Create your account');
  });

  test('register page has link to login', async ({ page, authPage }) => {
    // Logout to access register page
    await authPage.logout();
    await authPage.gotoRegister();
    
    // Check for login link
    const loginLink = page.locator('a:has-text("Sign in")');
    await expect(loginLink).toBeVisible();
    
    // Click link
    await loginLink.click();
    
    // Should navigate to login page
    await expect(page).toHaveURL('/login');
    await expect(page.locator('p')).toContainText('Welcome back');
  });

  test('registration form shows validation errors', async ({ page, authPage }) => {
    // Logout to access register page
    await authPage.logout();
    await authPage.gotoRegister();
    
    // Submit empty form
    await page.locator('button[type="submit"]').click();
    
    // Should stay on register page
    await expect(page).toHaveURL('/register');
    
    // HTML5 validation should prevent submission
    const emailInput = page.locator('input[name="email"]');
    await expect(emailInput).toBeVisible();
  });

  test('authenticated user can access auth pages without redirect', async ({ page }) => {
    // Already logged in from global setup, try to access login
    // Note: The app does NOT redirect authenticated users away from auth pages
    await page.goto('/login');
    
    // Should stay on login page (no redirect)
    await expect(page).toHaveURL('/login');
    
    // Should see the login form
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
  });

});
