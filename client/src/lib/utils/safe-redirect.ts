/**
 * Resolve a post-auth `?redirect=` value to a SAFE same-site path. Accepts only
 * absolute in-app paths; rejects protocol-relative (`//host`) and backslash
 * (`/\host`) forms that browsers treat as off-site. Falls back to '/'.
 */
export function safeRedirect(raw: string | null | undefined): string {
	if (!raw) return '/';
	if (!raw.startsWith('/')) return '/';
	if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
	return raw;
}
