import { chromium, FullConfig } from '@playwright/test';
import { TEST_USER } from './tests/fixtures';

/**
 * Global setup - runs once before all tests
 * Creates a test user that will be used across all tests
 */
async function globalSetup(config: FullConfig) {
  console.log('🚀 Global setup: Starting...');
  
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Try to register first
    console.log(`📋 Attempting to register user: ${TEST_USER.email}`);
    await page.goto(`${baseURL}/register`);
    await page.waitForSelector('h1:has-text("Alcoves")');
    
    await page.locator('input[name="email"]').fill(TEST_USER.email);
    await page.locator('input[name="password"]').fill(TEST_USER.password);
    await page.locator('button[type="submit"]').click();
    
    // Wait for either redirect (success) - accepts / or /libraries/*
    try {
      await page.waitForURL(/\/(libraries\/.*)?$/, { timeout: 5000 });
      console.log(`✅ Global setup: Test user created successfully`);
    } catch {
      // Registration failed - user probably exists, try logging in
      console.log(`⚠️  Registration failed, attempting login...`);
      
      await page.goto(`${baseURL}/login`);
      await page.waitForSelector('h1:has-text("Alcoves")');
      
      await page.locator('input[name="email"]').fill(TEST_USER.email);
      await page.locator('input[name="password"]').fill(TEST_USER.password);
      await page.locator('button[type="submit"]').click();
      
      // Wait for redirect to / or /libraries/*
      await page.waitForURL(/\/(libraries\/.*)?$/, { timeout: 5000 });
      console.log(`✅ Global setup: Test user logged in successfully`);
    }
    
    // Save the storage state (cookies/session) so tests can use it
    await context.storageState({ path: './test-user-state.json' });
    
    console.log(`✅ Global setup: Storage state saved for ${TEST_USER.email}`);
    
  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;
