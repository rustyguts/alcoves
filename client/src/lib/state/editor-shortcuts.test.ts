import { describe, it, expect, vi, afterEach } from 'vitest';

// Mutable so individual tests can flip the browser flag for attach/detach.
const env = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => env);

import { createEditorShortcuts, type KeyboardEventLike } from './editor-shortcuts';
import { JUMP_SECONDS } from './playback.svelte';

const FIELD_SELECTOR = 'input, textarea, select';
const ACTIVATION_SELECTOR = 'button, [role="button"], a';

function makeHandlers() {
	return {
		isSuspended: vi.fn(() => false),
		onTogglePlay: vi.fn(),
		onJump: vi.fn(),
		onStepFrame: vi.fn(),
		onCreate: vi.fn(),
		onSetStart: vi.fn(),
		onSetEnd: vi.fn(),
		onSplit: vi.fn(),
		onRequestDelete: vi.fn(),
		onZoomIn: vi.fn(),
		onZoomOut: vi.fn(),
		onZoomFit: vi.fn(),
		onScroll: vi.fn(),
		onCenter: vi.fn(),
		onToggleSnap: vi.fn(),
		onToggleLoop: vi.fn(),
		onOpenHelp: vi.fn()
	};
}

type Handlers = ReturnType<typeof makeHandlers>;
type HandlerName = Exclude<keyof Handlers, 'isSuspended'>;

function makeEvent(key: string, overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
	return { key, preventDefault: vi.fn(), ...overrides };
}

afterEach(() => {
	env.browser = true;
	vi.unstubAllGlobals();
});

const KEYMAP: Array<[key: string, handler: HandlerName, args: unknown[]]> = [
	[' ', 'onTogglePlay', []],
	['k', 'onTogglePlay', []],
	['j', 'onJump', [-JUMP_SECONDS]],
	['ArrowLeft', 'onJump', [-JUMP_SECONDS]],
	['l', 'onJump', [JUMP_SECONDS]],
	['ArrowRight', 'onJump', [JUMP_SECONDS]],
	[',', 'onStepFrame', [-1]],
	['.', 'onStepFrame', [1]],
	['m', 'onCreate', []],
	['n', 'onCreate', []],
	['i', 'onSetStart', []],
	['o', 'onSetEnd', []],
	['s', 'onSplit', []],
	['Delete', 'onRequestDelete', []],
	['Backspace', 'onRequestDelete', []],
	['z', 'onZoomIn', []],
	['=', 'onZoomIn', []],
	['+', 'onZoomIn', []],
	['x', 'onZoomOut', []],
	['-', 'onZoomOut', []],
	['_', 'onZoomOut', []],
	['f', 'onZoomFit', []],
	['a', 'onScroll', [-1]],
	['d', 'onScroll', [1]],
	['c', 'onCenter', []],
	['g', 'onToggleSnap', []],
	['r', 'onToggleLoop', []],
	['?', 'onOpenHelp', []]
];

describe('createEditorShortcuts — keymap', () => {
	it.each(KEYMAP)('%j fires %s (and only it) with preventDefault', (key, name, args) => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent(key);
		onKeydown(ev);
		expect(h[name]).toHaveBeenCalledTimes(1);
		expect(h[name]).toHaveBeenCalledWith(...args);
		expect(ev.preventDefault).toHaveBeenCalledTimes(1);
		for (const other of Object.keys(h) as Array<keyof Handlers>) {
			if (other === name || other === 'isSuspended') continue;
			expect(h[other]).not.toHaveBeenCalled();
		}
	});

	it.each([
		['K', 'onTogglePlay'],
		['J', 'onJump'],
		['L', 'onJump'],
		['M', 'onCreate'],
		['N', 'onCreate'],
		['I', 'onSetStart'],
		['O', 'onSetEnd'],
		['S', 'onSplit'],
		['Z', 'onZoomIn'],
		['X', 'onZoomOut'],
		['F', 'onZoomFit'],
		['A', 'onScroll'],
		['D', 'onScroll'],
		['C', 'onCenter'],
		['G', 'onToggleSnap'],
		['R', 'onToggleLoop']
	] as Array<[string, HandlerName]>)('uppercase %s folds to its lowercase binding', (key, name) => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		// Real uppercase letters arrive with shiftKey: true — allowed for non-arrows.
		const ev = makeEvent(key, { shiftKey: true });
		onKeydown(ev);
		expect(h[name]).toHaveBeenCalledTimes(1);
		expect(ev.preventDefault).toHaveBeenCalledTimes(1);
	});

	it('? still fires with shiftKey held (how the key is actually typed)', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent('?', { shiftKey: true });
		onKeydown(ev);
		expect(h.onOpenHelp).toHaveBeenCalledTimes(1);
		expect(ev.preventDefault).toHaveBeenCalledTimes(1);
	});

	it.each(['q', 'e', '1', 'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown'])(
		'unhandled key %j fires nothing and does NOT preventDefault',
		(key) => {
			const h = makeHandlers();
			const { onKeydown } = createEditorShortcuts(h);
			const ev = makeEvent(key);
			onKeydown(ev);
			expect(ev.preventDefault).not.toHaveBeenCalled();
			for (const name of Object.keys(h) as Array<keyof Handlers>) {
				if (name === 'isSuspended') continue;
				expect(h[name]).not.toHaveBeenCalled();
			}
		}
	);

	it('missing handlers are silent no-ops but mapped keys still preventDefault', () => {
		const { onKeydown } = createEditorShortcuts({});
		for (const [key] of KEYMAP) {
			const ev = makeEvent(key);
			expect(() => onKeydown(ev)).not.toThrow();
			expect(ev.preventDefault).toHaveBeenCalledTimes(1);
		}
	});
});

describe('createEditorShortcuts — guards', () => {
	it('skips events something else already handled (defaultPrevented)', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent(' ', { defaultPrevented: true });
		onKeydown(ev);
		expect(h.onTogglePlay).not.toHaveBeenCalled();
		expect(ev.preventDefault).not.toHaveBeenCalled();
	});

	it.each([[{ ctrlKey: true }], [{ metaKey: true }], [{ altKey: true }]])(
		'skips modifier chords %j (browser shortcuts win)',
		(mods) => {
			const h = makeHandlers();
			const { onKeydown } = createEditorShortcuts(h);
			const ev = makeEvent('k', mods);
			onKeydown(ev);
			expect(h.onTogglePlay).not.toHaveBeenCalled();
			expect(ev.preventDefault).not.toHaveBeenCalled();
		}
	);

	it('ctrl+z does not zoom (undo stays with the browser)', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent('z', { ctrlKey: true });
		onKeydown(ev);
		expect(h.onZoomIn).not.toHaveBeenCalled();
		expect(ev.preventDefault).not.toHaveBeenCalled();
	});

	it.each(['INPUT', 'TEXTAREA', 'SELECT', 'input'])(
		'skips keys typed into a %s element',
		(tagName) => {
			const h = makeHandlers();
			const { onKeydown } = createEditorShortcuts(h);
			const ev = makeEvent('m', { target: { tagName } });
			onKeydown(ev);
			expect(h.onCreate).not.toHaveBeenCalled();
			expect(ev.preventDefault).not.toHaveBeenCalled();
		}
	);

	it('skips contentEditable targets', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const ev = makeEvent('m', { target: { tagName: 'DIV', isContentEditable: true } });
		onKeydown(ev);
		expect(h.onCreate).not.toHaveBeenCalled();
		expect(ev.preventDefault).not.toHaveBeenCalled();
	});

	it('skips ALL keys for targets inside a form field (closest match)', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const closest = vi.fn((sel: string) => (sel === FIELD_SELECTOR ? {} : null));
		const ev = makeEvent('m', { target: { tagName: 'SPAN', closest } });
		onKeydown(ev);
		expect(closest).toHaveBeenCalledWith(FIELD_SELECTOR);
		expect(h.onCreate).not.toHaveBeenCalled();
		expect(ev.preventDefault).not.toHaveBeenCalled();
	});

	it('skips only Space/Enter on button-like targets — other keys still dispatch', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const closest = vi.fn((sel: string) => (sel === ACTIVATION_SELECTOR ? {} : null));

		// Space on a focused button: native activation wins, keymap stays silent.
		const space = makeEvent(' ', { target: { tagName: 'BUTTON', closest } });
		onKeydown(space);
		expect(h.onTogglePlay).not.toHaveBeenCalled();
		expect(space.preventDefault).not.toHaveBeenCalled();

		// But the rest of the keymap must survive focus resting on a button
		// (a click leaves focus there) — m creates, Delete deletes.
		onKeydown(makeEvent('m', { target: { tagName: 'BUTTON', closest } }));
		expect(h.onCreate).toHaveBeenCalledTimes(1);
		onKeydown(makeEvent('Delete', { target: { tagName: 'BUTTON', closest } }));
		expect(h.onRequestDelete).toHaveBeenCalledTimes(1);
	});

	it('dispatches when closest finds no interactive ancestor', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		const closest = vi.fn(() => null);
		const ev = makeEvent(' ', { target: { tagName: 'DIV', closest } });
		onKeydown(ev);
		expect(closest).toHaveBeenCalledWith(FIELD_SELECTOR);
		expect(closest).toHaveBeenCalledWith(ACTIVATION_SELECTOR);
		expect(h.onTogglePlay).toHaveBeenCalledTimes(1);
		expect(ev.preventDefault).toHaveBeenCalledTimes(1);
	});

	it('dispatches for null / bare targets (no tagName, no closest)', () => {
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		onKeydown(makeEvent('m', { target: null }));
		onKeydown(makeEvent('m', { target: {} }));
		onKeydown(makeEvent('m'));
		expect(h.onCreate).toHaveBeenCalledTimes(3);
	});

	it.each(['ArrowLeft', 'ArrowRight'])(
		'skips shift+%s (reserved for the moment-bar nudge)',
		(key) => {
			const h = makeHandlers();
			const { onKeydown } = createEditorShortcuts(h);
			const ev = makeEvent(key, { shiftKey: true });
			onKeydown(ev);
			expect(h.onJump).not.toHaveBeenCalled();
			expect(ev.preventDefault).not.toHaveBeenCalled();
		}
	);

	it('isSuspended() pauses the whole keymap until it returns false again', () => {
		let suspended = true;
		const h = { ...makeHandlers(), isSuspended: () => suspended };
		const { onKeydown } = createEditorShortcuts(h);

		const blocked = makeEvent('k');
		onKeydown(blocked);
		expect(h.onTogglePlay).not.toHaveBeenCalled();
		expect(blocked.preventDefault).not.toHaveBeenCalled();

		suspended = false;
		const allowed = makeEvent('k');
		onKeydown(allowed);
		expect(h.onTogglePlay).toHaveBeenCalledTimes(1);
		expect(allowed.preventDefault).toHaveBeenCalledTimes(1);
	});
});

describe('createEditorShortcuts — attach/detach', () => {
	it('registers and removes the same window keydown listener', () => {
		const add = vi.fn();
		const remove = vi.fn();
		vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove });

		const { onKeydown, attach, detach } = createEditorShortcuts(makeHandlers());
		attach();
		expect(add).toHaveBeenCalledWith('keydown', onKeydown);
		detach();
		expect(remove).toHaveBeenCalledWith('keydown', onKeydown);
	});

	it('attach/detach are no-ops outside the browser (no window access, no throw)', () => {
		env.browser = false;
		const { attach, detach } = createEditorShortcuts({});
		expect(() => {
			attach();
			detach();
		}).not.toThrow();
	});

	it('onKeydown is pure — dispatch works without ever attaching', () => {
		env.browser = false;
		const h = makeHandlers();
		const { onKeydown } = createEditorShortcuts(h);
		onKeydown(makeEvent(' '));
		expect(h.onTogglePlay).toHaveBeenCalledTimes(1);
	});
});
