// Stub for `$env/dynamic/public` in the browser (client) vitest project, where
// SvelteKit's env virtual module isn't initialized. Component tests run with no
// PUBLIC_* vars set, so apiUrl() resolves to same-origin relative paths. Tests
// that need a specific value mock `$lib/api`/`$lib/api/url` directly.
export const env: Record<string, string> = {};
