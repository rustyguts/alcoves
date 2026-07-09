import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
import { getContext, setContext } from 'svelte';
import { SIDEBAR_KEYBOARD_SHORTCUT } from './constants.js';

type Getter<T> = () => T;

// F19 rework helper: true when the shortcut's target is a text field or
// contenteditable region (incl. CodeMirror's contentDOM), so the global
// Ctrl/Cmd+B toggle doesn't fire while the user is typing there. Exported
// (deviation from vendored default) so it's independently unit-testable.
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return /^(input|textarea|select)$/i.test(target.tagName);
}

export type SidebarStateProps = {
	/**
	 * A getter function that returns the current open state of the sidebar.
	 * We use a getter function here to support `bind:open` on the `Sidebar.Provider`
	 * component.
	 */
	open: Getter<boolean>;

	/**
	 * A function that sets the open state of the sidebar. To support `bind:open`, we need
	 * a source of truth for changing the open state to ensure it will be synced throughout
	 * the sub-components and any `bind:` references.
	 */
	setOpen: (open: boolean) => void;
};

class SidebarState {
	readonly props: SidebarStateProps;
	open = $derived.by(() => this.props.open());
	openMobile = $state(false);
	setOpen: SidebarStateProps['setOpen'];
	#isMobile: IsMobile;
	state = $derived.by(() => (this.open ? 'expanded' : 'collapsed'));

	constructor(props: SidebarStateProps) {
		this.setOpen = props.setOpen;
		this.#isMobile = new IsMobile();
		this.props = props;
	}

	// Convenience getter for checking if the sidebar is mobile
	// without this, we would need to use `sidebar.isMobile.current` everywhere
	get isMobile() {
		return this.#isMobile.current;
	}

	// Event handler to apply to the `<svelte:window>`
	//
	// Deviation from vendored default (F19 rework): the registry version has no
	// editable-target guard, so Ctrl/Cmd+B toggles the sidebar even while typing
	// in a text input, the header search box, or the CodeMirror doc editor
	// (whose contentDOM is contenteditable). Guard by event target, mirroring
	// the same-purpose check already established in
	// `$lib/state/editor-shortcuts.ts`.
	handleShortcutKeydown = (e: KeyboardEvent) => {
		const isShortcut = e.key === SIDEBAR_KEYBOARD_SHORTCUT && (e.metaKey || e.ctrlKey);
		if (isShortcut && !isEditableTarget(e.target)) {
			e.preventDefault();
			this.toggle();
		}
	};

	setOpenMobile = (value: boolean) => {
		this.openMobile = value;
	};

	toggle = () => {
		return this.#isMobile.current ? (this.openMobile = !this.openMobile) : this.setOpen(!this.open);
	};
}

const SYMBOL_KEY = 'scn-sidebar';

/**
 * Instantiates a new `SidebarState` instance and sets it in the context.
 *
 * @param props The constructor props for the `SidebarState` class.
 * @returns  The `SidebarState` instance.
 */
export function setSidebar(props: SidebarStateProps): SidebarState {
	return setContext(Symbol.for(SYMBOL_KEY), new SidebarState(props));
}

/**
 * Retrieves the `SidebarState` instance from the context. This is a class instance,
 * so you cannot destructure it.
 * @returns The `SidebarState` instance.
 */
export function useSidebar(): SidebarState {
	return getContext(Symbol.for(SYMBOL_KEY));
}
