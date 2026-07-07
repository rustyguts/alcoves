import { describe, expect, it } from 'vitest';
import { isMarkdownFile } from './markdown-file';

describe('isMarkdownFile', () => {
	it('accepts the markdown mime type', () => {
		expect(isMarkdownFile('text/markdown')).toBe(true);
		expect(isMarkdownFile('text/markdown', 'anything.bin')).toBe(true);
	});

	it('falls back to the file extension for other mimes', () => {
		expect(isMarkdownFile('application/octet-stream', 'notes.md')).toBe(true);
		expect(isMarkdownFile('application/octet-stream', 'Notes.MARKDOWN')).toBe(true);
		expect(isMarkdownFile('text/plain', 'notes.txt')).toBe(false);
	});

	it('rejects non-markdown files', () => {
		expect(isMarkdownFile('image/png', 'photo.png')).toBe(false);
		expect(isMarkdownFile(null, null)).toBe(false);
		expect(isMarkdownFile(undefined)).toBe(false);
	});
});
