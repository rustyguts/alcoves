/**
 * Live-document eligibility — mirrors the backend's `isMarkdown` check
 * (mime, with a name fallback for markdown uploaded as octet-stream).
 */
export function isMarkdownFile(mimeType: string | null | undefined, name?: string | null): boolean {
	if (mimeType === 'text/markdown') return true;
	const lower = (name ?? '').toLowerCase();
	return lower.endsWith('.md') || lower.endsWith('.markdown');
}
