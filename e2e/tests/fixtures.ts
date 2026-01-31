import { test as base, expect, Page } from '@playwright/test';

/**
 * Test user credentials - used across all tests
 * This is a static user created during global setup
 */
export const TEST_USER = {
  email: 'test-e2e@alcoves.test',
  password: 'TestPassword123!',
};

/**
 * Page Object Model for authentication pages
 */
export class AuthPage {
  constructor(private page: Page) {}

  async gotoRegister() {
    await this.page.goto('/register');
    await expect(this.page.locator('h1')).toContainText('Alcoves');
  }

  async gotoLogin() {
    await this.page.goto('/login');
    await expect(this.page.locator('h1')).toContainText('Alcoves');
  }

  async register(email: string, password: string) {
    await this.gotoRegister();
    
    // Fill registration form
    await this.page.locator('input[name="email"]').fill(email);
    await this.page.locator('input[name="password"]').fill(password);
    
    // Submit form
    await this.page.locator('button[type="submit"]').click();
    
    // Wait for redirect to home page
    await this.page.waitForURL('/', { timeout: 5000 });
  }

  async login(email: string, password: string) {
    await this.gotoLogin();
    
    // Fill login form
    await this.page.locator('input[name="email"]').fill(email);
    await this.page.locator('input[name="password"]').fill(password);
    
    // Submit form
    await this.page.locator('button[type="submit"]').click();
    
    // Wait for redirect to home page
    await this.page.waitForURL('/', { timeout: 5000 });
  }

  async logout() {
    // Use context's request to POST to logout endpoint
    await this.page.context().request.post('/logout');
    await this.page.goto('/login');
    await this.page.waitForLoadState('networkidle');
  }

  async expectLoggedIn() {
    // Should see library page elements
    await expect(this.page.locator('h1')).toBeVisible();
  }

  async expectLoggedOut() {
    // Should see login page
    await expect(this.page.locator('button:has-text("Sign In")')).toBeVisible();
  }
}

/**
 * Page Object Model for library pages
 */
export class LibraryPage {
  constructor(private page: Page) {}

  async expectLibraryLoaded() {
    // Wait for library name to be visible
    await expect(this.page.locator('h1')).toBeVisible();
    
    // Wait for file table or folder view to load
    await expect(this.page.locator('#files-table, .folder-grid')).toBeVisible({ timeout: 10000 });
  }

  async uploadFile(filePath: string) {
    // Click upload button
    await this.page.locator('button:has-text("Upload")').click();
    
    // Wait for modal
    await expect(this.page.locator('#upload_modal')).toBeVisible();
    
    // Note: File upload testing requires specific setup
    // This is a placeholder - actual implementation would use file input
    console.log(`Would upload file: ${filePath}`);
    
    // Close modal for now
    await this.page.locator('#close_upload_modal').click();
  }

  async toggleView(view: 'list' | 'folder') {
    const buttonTitle = view === 'list' ? 'List view' : 'Folder view';
    await this.page.locator(`button[title="${buttonTitle}"]`).click();
    
    // Verify view mode changed
    if (view === 'folder') {
      await expect(this.page.locator('.folder-grid')).toBeVisible();
    } else {
      await expect(this.page.locator('#files-table')).toBeVisible();
    }
  }

  async createFolder(name: string) {
    // Switch to folder view if not already
    await this.toggleView('folder');
    
    // Click create folder button
    await this.page.locator('button:has-text("Create Folder")').click();
    
    // Wait for modal
    await expect(this.page.locator('#folder-modal')).toBeVisible();
    
    // Fill folder name
    await this.page.locator('#folder-name-input').fill(name);
    
    // Submit
    await this.page.locator('#create-folder-btn').click();
    
    // Wait for folder to appear
    await expect(this.page.locator(`text=${name}`)).toBeVisible();
  }

  async selectFile(filename: string) {
    // Find file row and click checkbox
    const fileRow = this.page.locator(`.file-row:has-text("${filename}")`);
    await fileRow.locator('.file-checkbox').click();
    
    // Verify selection
    await expect(fileRow).toHaveClass(/bg-primary\/20/);
  }

  async expectFileVisible(filename: string) {
    await expect(this.page.locator(`text=${filename}`).first()).toBeVisible();
  }

  async expectFileNotVisible(filename: string) {
    await expect(this.page.locator(`text=${filename}`).first()).not.toBeVisible();
  }
}

/**
 * Extended test fixture with page objects
 */
export const test = base.extend<{
  authPage: AuthPage;
  libraryPage: LibraryPage;
  testUser: typeof TEST_USER;
}>({
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
  libraryPage: async ({ page }, use) => {
    await use(new LibraryPage(page));
  },
  testUser: async ({}, use) => {
    // Generate unique test user for each test
    const user = {
      email: `test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`,
      password: 'TestPassword123!',
    };
    await use(user);
  },
});

export { expect };
