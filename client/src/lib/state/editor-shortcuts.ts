import { browser } from '$app/environment';

export interface EditorShortcutHandlers {
	/** Whether a moment is currently selected (gates the I/O in/out shortcuts). */
	hasSelection: () => boolean;
	onSetStart: () => void;
	onSetEnd: () => void;
	onCreate: () => void;
	onTogglePlay: () => void;
}

/** A minimal keydown shape so the dispatcher is testable without a real DOM. */
export interface KeyboardEventLike {
	key: string;
	target?: { tagName?: string } | null;
	preventDefault: () => void;
}

/**
 * Editor keyboard shortcuts: I/O set in/out points on the selected moment,
 * M creates a new moment at the playhead, Space toggles playback. Skips when
 * focus is in a text input so it doesn't hijack typing.
 *
 * `createEditorShortcuts` returns a pure `onKeydown` dispatcher plus explicit
 * `attach`/`detach` methods the consuming component wires from onMount/onDestroy.
 * No runes or lifecycle hooks live here, so the dispatch logic is unit-testable
 * in the node project by calling `onKeydown` with a fake event.
 */
export function createEditorShortcuts(handlers: EditorShortcutHandlers) {
	function onKeydown(e: KeyboardEventLike) {
		const tagName = e.target?.tagName;
		if (tagName && /input|textarea|select/i.test(tagName)) return;
		if (e.key === 'i' || e.key === 'I') {
			if (handlers.hasSelection()) handlers.onSetStart();
			e.preventDefault();
		} else if (e.key === 'o' || e.key === 'O') {
			if (handlers.hasSelection()) handlers.onSetEnd();
			e.preventDefault();
		} else if (e.key === 'm' || e.key === 'M') {
			handlers.onCreate();
			e.preventDefault();
		} else if (e.key === ' ') {
			handlers.onTogglePlay();
			e.preventDefault();
		}
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
