# End-to-End (E2E) Tests for Alcoves

This directory contains Playwright-based end-to-end UI tests that verify user flows by controlling a real browser.

## Test User Strategy

The tests use a **shared test user** created once before all tests run (via global setup):
- **Email**: `test-e2e@alcoves.test`
- **Password**: `TestPassword123!`

This approach is much faster than creating a new user for each test, and mimics how a real user would interact with the app over a session.

## Setup

1. Install Node.js dependencies:
```bash
cd e2e
npm install
```

2. Install Playwright browsers:
```bash
npx playwright install
```

## Quick Start

Run all tests (automatically starts server and creates test user):
```bash
cd e2e
npm test
```

This will:
1. Start the Go server automatically
2. Create the test user via global setup
3. Run all tests with the authenticated user
4. Show HTML report

## Running Tests

### Run all tests (headless mode)
```bash
cd e2e
npm test
```

### Run tests with visible browser (headed mode)
```bash
cd e2e
npm run test:headed
```

### Run tests in debug mode
```bash
cd e2e
npm run test:debug
```

### Run specific test file
```bash
npx playwright test auth.spec.ts
```

### Run tests in specific browser
```bash
npx playwright test --project=firefox
```

## Test Structure

- `tests/fixtures.ts` - Test fixtures and Page Object Models (AuthPage, LibraryPage)
- `tests/auth.spec.ts` - Authentication flows (register, login, logout)
- `tests/library-view.spec.ts` - Library view toggle and navigation
- `tests/file-and-folder.spec.ts` - File selection, keyboard shortcuts, folder management

## How It Works

1. **Test Server**: Playwright automatically starts the Go server before tests run (configured in `playwright.config.ts`)
2. **Database**: Tests use a SQLite database (`test.db`) that is created fresh for each test run
3. **Browser Control**: Playwright controls Chromium/Firefox to simulate real user interactions
4. **Assertions**: Tests verify UI state, URL changes, and element visibility

## Page Object Pattern

We use the Page Object pattern for maintainable tests:

```typescript
// Instead of writing this in every test:
await page.locator('input[name="email"]').fill('test@example.com');
await page.locator('input[name="password"]').fill('password');
await page.locator('button[type="submit"]').click();

// We write:
await authPage.register('test@example.com', 'password');
```

This makes tests more readable and easier to update when UI changes.

## Key Testing Features

### Authentication Tests
- User registration flow
- Login/logout flows
- Form validation
- Protected route redirects

### Library View Tests
- Toggle between list and folder views
- Upload button visibility
- Library dropdown menu
- Empty states

### File & Folder Tests
- Keyboard shortcuts (Ctrl+A, Escape, arrow keys)
- File selection with click/Shift+click
- Folder creation and management
- Context menus
- Visual feedback (selection highlighting)

## Debugging Failed Tests

1. **Screenshots**: Automatically captured on failure in `test-results/`
2. **Videos**: Recorded for failed tests (configured in `playwright.config.ts`)
3. **Traces**: Detailed execution traces available in HTML report
4. **HTML Report**: Run `npx playwright show-report` to view detailed results

## Best Practices

1. **Use Page Objects**: Keep test logic in fixtures.ts, test files should read like user stories
2. **Unique Test Data**: Each test gets a unique email address to avoid conflicts
3. **Wait for Navigation**: Always wait for URL changes after form submissions
4. **Check Visibility**: Verify elements are visible before interacting with them
5. **Handle Empty States**: Tests gracefully handle empty libraries

## CI/CD Integration

Tests are configured to run in CI mode with:
- 2 retries on failure
- Single worker (sequential execution)
- Headless browsers
- Test reporting in HTML format

## Troubleshooting

### Server doesn't start
Check that port 8080 is not already in use:
```bash
lsof -ti:8080 | xargs kill -9
```

### Tests timeout
Increase timeout in `playwright.config.ts` or check that the server is running properly.

### Database conflicts
Delete the test database:
```bash
rm e2e/test.db
```
