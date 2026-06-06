import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
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

// The popover content only mounts once open — click the trigger to reveal it.
async function open(screen: ReturnType<typeof render>) {
	const trigger = screen.container.querySelector('button[aria-haspopup]') as HTMLButtonElement;
	expect(trigger).not.toBeNull();
	trigger.click();
	// Wait for the content to mount.
	await vi.waitFor(() => {
		expect(screen.container.querySelectorAll('button').length).toBeGreaterThan(1);
	});
}

function menuLabels(screen: ReturnType<typeof render>): string[] {
	return Array.from(screen.container.querySelectorAll('button'))
		.map((b) => (b as HTMLElement).textContent?.trim().replace(/\s+/g, ' ') ?? '')
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
		const trigger = screen.container.querySelector('button[aria-haspopup]') as HTMLElement;
		expect(trigger.textContent).toContain('Projects');
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
		const trigger = screen.container.querySelector('button[aria-haspopup]') as HTMLElement;
		expect(trigger.textContent).toContain('Home');
	});

	it('shows a Select library placeholder when there are no libraries', () => {
		const screen = render(LibrarySwitcher, {
			props: { libraries: [], currentLibraryId: null }
		});
		const trigger = screen.container.querySelector('button[aria-haspopup]') as HTMLElement;
		expect(trigger.textContent).toContain('Select library');
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
		const labels = menuLabels(screen).filter((t) => t !== 'Home Projects'); // exclude trigger text
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
		const projects = Array.from(screen.container.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('Projects')
		) as HTMLButtonElement;
		expect(projects).toBeTruthy();
		projects.click();
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
		const createBtn = Array.from(screen.container.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('New library')
		) as HTMLButtonElement;
		expect(createBtn).toBeTruthy();
		createBtn.click();
		expect(oncreate).toHaveBeenCalledOnce();
	});

	it('renders the emoji glyph in the trigger when the current library has one', () => {
		const screen = render(LibrarySwitcher, {
			props: {
				libraries: [lib({ id: 'def', name: 'Home', isDefault: true, emoji: '🏠' })],
				currentLibraryId: 'def'
			}
		});
		const trigger = screen.container.querySelector('button[aria-haspopup]') as HTMLElement;
		expect(trigger.textContent).toContain('🏠');
	});
});
