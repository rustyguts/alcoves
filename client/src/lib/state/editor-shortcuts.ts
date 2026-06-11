import { browser } from '$app/environment';
import { JUMP_SECONDS } from '$lib/state/playback.svelte';

/**
 * Editor keyboard shortcuts — the ONE window keydown listener for the editor.
 *
 * Keymap (all handled keys preventDefault):
 *   Playback: Space/K play-pause · J/← back 5s · L/→ forward 5s ·
 *             , step back ~1 frame · . step forward · R loop selected moment
 *   Moments:  M/N new at playhead · I set start · O set end · S split ·
 *             Delete/Backspace delete selected
 *   Timeline: Z/= zoom in · X/- zoom out · F zoom to fit · A/D scroll ·
 *             C center on playhead · G toggle snapping · ? help
 *
 * Guards (early return, nothing fired):
 *   - `defaultPrevented` events (a focused moment bar consumes its own keys)
 *   - focus in input/textarea/select or contentEditable (all keys)
 *   - Space/Enter on a button / [role="button"] / link — native activation
 *     wins so it never double-fires; every OTHER key still works, because a
 *     click leaves focus on the button and the keymap must not go dead
 *   - ctrl/meta/alt chords (browser shortcuts win)
 *   - shift+arrow (reserved for the moment-bar nudge)
 *   - `isSuspended()` (the page suspends the map while a modal is open)
 *
 * `createEditorShortcuts` returns a pure `onKeydown` dispatcher plus explicit
 * `attach`/`detach` methods, so dispatch logic is unit-testable in the node
 * project with fake events. Every handler is optional: shortcuts pressed
 * before a controller registers are silent no-ops.
 */
export interface EditorShortcutHandlers {
	/** Pause the whole keymap (e.g. while a modal is open). */
	isSuspended?: () => boolean;
	onTogglePlay?: () => void;
	onJump?: (seconds: number) => void;
	onStepFrame?: (frames: number) => void;
	onCreate?: () => void;
	onSetStart?: () => void;
	onSetEnd?: () => void;
	onSplit?: () => void;
	onRequestDelete?: () => void;
	onZoomIn?: () => void;
	onZoomOut?: () => void;
	onZoomFit?: () => void;
	onScroll?: (direction: -1 | 1) => void;
	onCenter?: () => void;
	onToggleSnap?: () => void;
	onToggleLoop?: () => void;
	onOpenHelp?: () => void;
}

/** A minimal keydown shape so the dispatcher is testable without a real DOM. */
export interface KeyboardEventLike {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	defaultPrevented?: boolean;
	target?: {
		tagName?: string;
		isContentEditable?: boolean;
		closest?: (selector: string) => unknown;
	} | null;
	preventDefault: () => void;
}

const FIELD_SELECTOR = 'input, textarea, select';
const ACTIVATION_SELECTOR = 'button, [role="button"], a';

export function createEditorShortcuts(handlers: EditorShortcutHandlers) {
	function onKeydown(e: KeyboardEventLike) {
		if (e.defaultPrevented) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (handlers.isSuspended?.()) return;

		const target = e.target;
		const tagName = target?.tagName;
		if (tagName && /input|textarea|select/i.test(tagName)) return;
		if (target?.isContentEditable) return;
		if (typeof target?.closest === 'function') {
			// Text fields swallow everything; button-like elements swallow only
			// their native activation keys (Space/Enter) so the rest of the keymap
			// survives a click leaving focus on a toolbar button or moment bar.
			if (target.closest(FIELD_SELECTOR)) return;
			if ((e.key === ' ' || e.key === 'Enter') && target.closest(ACTIVATION_SELECTOR)) return;
		}

		const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
		if (e.shiftKey && isArrow) return; // reserved for moment-bar nudge

		// Named keys keep their case; single characters fold to lowercase.
		const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

		let handled = true;
		switch (key) {
			case ' ':
			case 'k':
				handlers.onTogglePlay?.();
				break;
			case 'j':
			case 'ArrowLeft':
				handlers.onJump?.(-JUMP_SECONDS);
				break;
			case 'l':
			case 'ArrowRight':
				handlers.onJump?.(JUMP_SECONDS);
				break;
			case ',':
				handlers.onStepFrame?.(-1);
				break;
			case '.':
				handlers.onStepFrame?.(1);
				break;
			case 'm':
			case 'n':
				handlers.onCreate?.();
				break;
			case 'i':
				handlers.onSetStart?.();
				break;
			case 'o':
				handlers.onSetEnd?.();
				break;
			case 's':
				handlers.onSplit?.();
				break;
			case 'Delete':
			case 'Backspace':
				handlers.onRequestDelete?.();
				break;
			case 'z':
			case '=':
			case '+':
				handlers.onZoomIn?.();
				break;
			case 'x':
			case '-':
			case '_':
				handlers.onZoomOut?.();
				break;
			case 'f':
				handlers.onZoomFit?.();
				break;
			case 'a':
				handlers.onScroll?.(-1);
				break;
			case 'd':
				handlers.onScroll?.(1);
				break;
			case 'c':
				handlers.onCenter?.();
				break;
			case 'g':
				handlers.onToggleSnap?.();
				break;
			case 'r':
				handlers.onToggleLoop?.();
				break;
			case '?':
				handlers.onOpenHelp?.();
				break;
			default:
				handled = false;
		}
		if (handled) e.preventDefault();
	}

	function attach() {
		if (!browser) return;
		window.addEventListener('keydown', onKeydown as (e: KeyboardEvent) => void);
	}

	function detach() {
		if (!browser) return;
		window.removeEventListener('keydown', onKeydown as (e: KeyboardEvent) => void);
	}

	return { onKeydown, attach, detach };
}
