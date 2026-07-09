import { describe, it, expect } from 'vitest';
import { isEditableTarget } from './context.svelte';

// F19 rework: the global Ctrl/Cmd+B sidebar shortcut must not fire while the
// user is typing in an input/textarea/select or a contenteditable region
// (e.g. CodeMirror's contentDOM in the live-document editor). Real-DOM test
// of the guard predicate (uses HTMLElement, hence the chromium project).
describe('isEditableTarget', () => {
	it('returns false for a non-element target (e.g. window)', () => {
		expect(isEditableTarget(null)).toBe(false);
		expect(isEditableTarget({} as EventTarget)).toBe(false);
	});

	it('returns false for a plain div', () => {
		expect(isEditableTarget(document.createElement('div'))).toBe(false);
	});

	it.each(['input', 'textarea', 'select'])('returns true for a %s element', (tag) => {
		expect(isEditableTarget(document.createElement(tag))).toBe(true);
	});

	it('is case-insensitive on tagName', () => {
		const el = document.createElement('input');
		Object.defineProperty(el, 'tagName', { value: 'INPUT' });
		expect(isEditableTarget(el)).toBe(true);
	});

	it('returns true for a contenteditable element (e.g. CodeMirror contentDOM)', () => {
		const el = document.createElement('div');
		el.contentEditable = 'true';
		expect(isEditableTarget(el)).toBe(true);
	});
});
