import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { createEditorShortcuts, type KeyboardEventLike } from './editor-shortcuts';

function makeHandlers(hasSelection: boolean) {
	let selected = hasSelection;
	return {
		hasSelection: () => selected,
		setSelected: (v: boolean) => {
			selected = v;
		},
		onSetStart: vi.fn(),
		onSetEnd: vi.fn(),
		onCreate: vi.fn(),
		onTogglePlay: vi.fn()
	};
}

function makeEvent(key: string, target?: { tagName?: string } | null): KeyboardEventLike {
	return { key, target, preventDefault: vi.fn() };
}

describe('createEditorShortcuts', () => {
	it('I/O set in/out only when something is selected', () => {
		const h = makeHandlers(false);
		const { onKeydown } = createEditorShortcuts(h);

		onKeydown(makeEvent('i'));
		onKeydown(makeEvent('o'));
		expect(h.onSetStart).not.toHaveBeenCalled();
		expect(h.onSetEnd).not.toHaveBeenCalled();

		h.setSelected(true);
		onKeydown(makeEvent('i'));
		onKeydown(makeEvent('O'));
		expect(h.onSetStart).toHaveBeenCalledTimes(1);
		expect(h.onSetEnd).toHaveBeenCalledTimes(1);
	});

	it('I/O always preventDefault, even with nothing selected', () => {
		const h = makeHandlers(false);
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent('I');
		onKeydown(ev);
		expect(ev.preventDefault).toHaveBeenCalledTimes(1);
		const ev2 = makeEvent('o');
		onKeydown(ev2);
		expect(ev2.preventDefault).toHaveBeenCalledTimes(1);
	});

	it('M creates regardless of selection and preventDefaults', () => {
		const h = makeHandlers(false);
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent('m');
		onKeydown(ev);
		expect(h.onCreate).toHaveBeenCalledTimes(1);
		expect(ev.preventDefault).toHaveBeenCalledTimes(1);
		onKeydown(makeEvent('M'));
		expect(h.onCreate).toHaveBeenCalledTimes(2);
	});

	it('Space toggles playback and preventDefaults', () => {
		const h = makeHandlers(false);
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent(' ');
		onKeydown(ev);
		expect(h.onTogglePlay).toHaveBeenCalledTimes(1);
		expect(ev.preventDefault).toHaveBeenCalledTimes(1);
	});

	it('ignores unrelated keys without preventDefault', () => {
		const h = makeHandlers(true);
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent('a');
		onKeydown(ev);
		expect(h.onSetStart).not.toHaveBeenCalled();
		expect(h.onSetEnd).not.toHaveBeenCalled();
		expect(h.onCreate).not.toHaveBeenCalled();
		expect(h.onTogglePlay).not.toHaveBeenCalled();
		expect(ev.preventDefault).not.toHaveBeenCalled();
	});

	it('ignores keypresses fired from text inputs (input/textarea/select)', () => {
		const h = makeHandlers(true);
		const { onKeydown } = createEditorShortcuts(h);
		for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
			onKeydown(makeEvent('i', { tagName: tag }));
			onKeydown(makeEvent('m', { tagName: tag }));
			onKeydown(makeEvent(' ', { tagName: tag }));
		}
		expect(h.onSetStart).not.toHaveBeenCalled();
		expect(h.onCreate).not.toHaveBeenCalled();
		expect(h.onTogglePlay).not.toHaveBeenCalled();
	});

	it('still dispatches when target is null or has no tagName', () => {
		const h = makeHandlers(true);
		const { onKeydown } = createEditorShortcuts(h);
		onKeydown(makeEvent('m', null));
		onKeydown(makeEvent('m', {}));
		expect(h.onCreate).toHaveBeenCalledTimes(2);
	});

	it('attach/detach register and remove a window keydown listener', () => {
		const add = vi.fn();
		const remove = vi.fn();
		vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });

		const h = makeHandlers(true);
		const { onKeydown, attach, detach } = createEditorShortcuts(h);

		attach();
		expect(add).toHaveBeenCalledWith('keydown', onKeydown);

		detach();
		expect(remove).toHaveBeenCalledWith('keydown', onKeydown);

		vi.unstubAllGlobals();
	});

	it('a dispatched event reaches handlers through the attached listener', () => {
		let registered: ((e: KeyboardEventLike) => void) | null = null;
		const add = vi.fn((_type: string, fn: (e: KeyboardEventLike) => void) => {
			registered = fn;
		});
		vi.stubGlobal('window', { addEventListener: add, removeEventListener: vi.fn() });

		const h = makeHandlers(true);
		const { attach } = createEditorShortcuts(h);
		attach();
		expect(registered).not.toBeNull();
		registered!(makeEvent('i'));
		expect(h.onSetStart).toHaveBeenCalledTimes(1);

		vi.unstubAllGlobals();
	});
});

describe('createEditorShortcuts in a non-browser environment', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('attach/detach are no-ops when browser is false', async () => {
		vi.doMock('$app/environment', () => ({ browser: false }));
		const add = vi.fn();
		const remove = vi.fn();
		vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });

		const mod = await import('./editor-shortcuts');
		const h = makeHandlers(true);
		const { attach, detach } = mod.createEditorShortcuts(h);
		attach();
		detach();
		expect(add).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();

		vi.unstubAllGlobals();
		vi.doUnmock('$app/environment');
	});
});
