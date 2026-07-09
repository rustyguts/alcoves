import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import LibrarySwitcher from './LibrarySwitcher.svelte';
import type { Library } from '$lib/types/api';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({
	goto: (...args: unknown[]) => goto(...args)
}));

function lib(over: Partial<Library>): Library {
	return {
		id: 'lib-1',
		name: 'Library One',
		emoji: null,
		isDefault: false,
		faceRecognitionEnabled: false,
		objectDetectionEnabled: false,
		sharingEnabled: false,
		ownerId: 'owner-x',
		currentUserRole: 'viewer',
		createdAt: '',
		updatedAt: '',
		...over
	};
}

beforeEach(() => {
	goto.mockClear();
});

// bits-ui's DropdownMenu.Content is portalled to `document.body`, so its rows
// (`role="menuitem"`) are queried from `document`, not `screen.container`.
function trigger(screen: ReturnType<typeof render>): HTMLButtonElement {
	return screen.container.querySelector('button[aria-haspopup]') as HTMLButtonElement;
}

function menuItems(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

// The dropdown content only mounts once open — click the trigger to reveal it.
async function open(screen: ReturnType<typeof render>) {
	const t = trigger(screen);
	expect(t).not.toBeNull();
	t.click();
	await vi.waitFor(() => {
		expect(menuItems().length).toBeGreaterThan(0);
	});
}

function menuLabels(): string[] {
	return menuItems()
		.map((b) => b.textContent?.trim().replace(/\s+/g, ' ') ?? '')
		.filter((t) => t.length > 0);
}

describe('LibrarySwitcher', () => {
	it('shows the current library in the trigger', async () => {
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [
					lib({ id: 'def', name: 'Home', isDefault: true }),
					lib({ id: 'lib-2', name: 'Projects' })
				],
				currentLibraryId: 'lib-2'
			}
		});
		expect(trigger(screen).textContent).toContain('Projects');
	});

	it('falls back to the default library when none is current', () => {
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [
					lib({ id: 'def', name: 'Home', isDefault: true }),
					lib({ id: 'lib-2', name: 'Projects' })
				],
				currentLibraryId: null
			}
		});
		expect(trigger(screen).textContent).toContain('Home');
	});

	it('shows a Select library placeholder when there are no libraries', () => {
		const screen = render(LibrarySwitcher, {
			props: { libraries: [], currentLibraryId: null }
		});
		expect(trigger(screen).textContent).toContain('Select library');
	});

	it('pins the default first, lists others sorted, then the create action', async () => {
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [
					lib({ id: 'lib-b', name: 'Beta' }),
					lib({ id: 'def', name: 'Home', isDefault: true }),
					lib({ id: 'lib-a', name: 'Alpha' })
				],
				currentLibraryId: 'def'
			}
		});
		await open(screen);
		const labels = menuLabels();
		// Default pinned first, others sorted A→Z, create action last.
		expect(labels).toContain('Home');
		const homeIdx = labels.indexOf('Home');
		const alphaIdx = labels.indexOf('Alpha');
		const betaIdx = labels.indexOf('Beta');
		const createIdx = labels.indexOf('New library');
		expect(homeIdx).toBeLessThan(alphaIdx);
		expect(alphaIdx).toBeLessThan(betaIdx);
		expect(betaIdx).toBeLessThan(createIdx);
		expect(createIdx).toBe(labels.length - 1);
	});

	it('navigates to the selected library on click', async () => {
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [
					lib({ id: 'def', name: 'Home', isDefault: true }),
					lib({ id: 'lib-2', name: 'Projects' })
				],
				currentLibraryId: 'def'
			}
		});
		await open(screen);
		const projects = menuItems().find((b) => b.textContent?.includes('Projects'));
		expect(projects).toBeTruthy();
		(projects as HTMLElement).click();
		await tick();
		expect(goto).toHaveBeenCalledWith('/libraries/lib-2');
	});

	it('fires oncreate when the New library action is clicked', async () => {
		const oncreate = vi.fn();
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [lib({ id: 'def', name: 'Home', isDefault: true })],
				currentLibraryId: 'def',
				oncreate
			}
		});
		await open(screen);
		const createBtn = menuItems().find((b) => b.textContent?.includes('New library'));
		expect(createBtn).toBeTruthy();
		(createBtn as HTMLElement).click();
		await tick();
		expect(oncreate).toHaveBeenCalledOnce();
	});

	it('renders the emoji glyph in the trigger when the current library has one', () => {
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [lib({ id: 'def', name: 'Home', isDefault: true, emoji: '🏠' })],
				currentLibraryId: 'def'
			}
		});
		expect(trigger(screen).textContent).toContain('🏠');
	});

	it('shows each library emoji exactly once per dropdown row (not duplicated)', async () => {
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [
					lib({ id: 'def', name: 'Home', isDefault: true, emoji: '🏠' }),
					lib({ id: 'lib-2', name: 'Projects', emoji: '🚀' })
				],
				currentLibraryId: 'def'
			}
		});
		await open(screen);
		const rows = menuItems();
		const homeRow = rows.find((b) => b.textContent?.includes('Home'));
		const projRow = rows.find((b) => b.textContent?.includes('Projects'));
		expect((homeRow?.textContent?.match(/🏠/g) ?? []).length).toBe(1);
		expect((projRow?.textContent?.match(/🚀/g) ?? []).length).toBe(1);
	});
});
