import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SidebarLibraryNav from './SidebarLibraryNav.svelte';
import type { AuthUser, Library } from '$lib/types/api';

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
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

const owner: AuthUser = {
	id: 'owner-x',
	email: 'o@example.com',
	displayName: 'Owner',
	avatarUrl: null,
	role: 'owner'
};

// All nav links rendered by the static section nav(s) — the LibrarySwitcher
// trigger is a <button>, so anchors uniquely identify the section links.
function navLabels(screen: ReturnType<typeof render>): string[] {
	return Array.from(screen.container.querySelectorAll('a'))
		.map((a) => a.textContent?.trim() ?? '')
		.filter((t) => t.length > 0);
}

function navLink(screen: ReturnType<typeof render>, label: string): HTMLAnchorElement | undefined {
	return Array.from(screen.container.querySelectorAll('a')).find(
		(a) => a.textContent?.trim() === label
	) as HTMLAnchorElement | undefined;
}

describe('SidebarLibraryNav', () => {
	it("renders the current library's sections, Files first and Trash last", () => {
		const screen = render(SidebarLibraryNav, {
			props: { libraries: [lib({ isDefault: true, ownerId: 'owner-x' })], user: owner }
		});
		const labels = navLabels(screen);
		expect(labels[0]).toBe('Files');
		expect(labels).toEqual(expect.arrayContaining(['Timeline', 'Map', 'Tags', 'Feed']));
		const trashIdx = labels.indexOf('Trash');
		expect(trashIdx).toBeGreaterThan(0);
		// Trash is the last *library* action (Admin lives in a separate nav, after it).
		expect(labels.indexOf('Files')).toBeLessThan(trashIdx);
	});

	it('points each section link at the active library base path', () => {
		const screen = render(SidebarLibraryNav, {
			props: { libraries: [lib({ id: 'def', isDefault: true })], user: owner }
		});
		expect(navLink(screen, 'Files')?.getAttribute('href')).toBe('/libraries/def');
		expect(navLink(screen, 'Timeline')?.getAttribute('href')).toBe('/libraries/def/timeline');
		expect(navLink(screen, 'Trash')?.getAttribute('href')).toBe('/libraries/def/trash');
	});

	it('includes People only when face recognition is enabled', () => {
		const on = render(SidebarLibraryNav, {
			props: {
				libraries: [lib({ isDefault: true, faceRecognitionEnabled: true })],
				user: owner
			}
		});
		expect(navLabels(on)).toContain('People');

		const off = render(SidebarLibraryNav, {
			props: { libraries: [lib({ isDefault: true })], user: owner }
		});
		expect(navLabels(off)).not.toContain('People');
	});

	it('never shows Objects in the sidebar — it lives on the Settings page', () => {
		const screen = render(SidebarLibraryNav, {
			props: {
				libraries: [lib({ isDefault: true, objectDetectionEnabled: true })],
				user: owner
			}
		});
		expect(navLabels(screen)).not.toContain('Objects');
	});

	it('shows Settings only when the user can manage the library', () => {
		const can = render(SidebarLibraryNav, {
			props: { libraries: [lib({ isDefault: true, ownerId: 'owner-x' })], user: owner }
		});
		expect(navLabels(can)).toContain('Settings');

		const cannot = render(SidebarLibraryNav, {
			props: {
				libraries: [lib({ isDefault: true, ownerId: 'someone-else', currentUserRole: 'viewer' })],
				user: owner
			}
		});
		expect(navLabels(cannot)).not.toContain('Settings');
	});

	it('shows Admin only for owner-role users', () => {
		const asOwner = render(SidebarLibraryNav, {
			props: { libraries: [lib({ isDefault: true })], user: owner }
		});
		expect(navLabels(asOwner)).toContain('Admin');

		const asMember = render(SidebarLibraryNav, {
			props: { libraries: [lib({ isDefault: true })], user: { ...owner, role: 'member' } }
		});
		expect(navLabels(asMember)).not.toContain('Admin');
	});

	it('marks the active tab from currentPath', () => {
		const screen = render(SidebarLibraryNav, {
			props: {
				libraries: [lib({ id: 'def', isDefault: true })],
				user: owner,
				currentPath: '/libraries/def/timeline'
			}
		});
		const timeline = navLink(screen, 'Timeline');
		expect(timeline?.getAttribute('aria-current')).toBe('page');
		// Files is not active when on the timeline tab.
		expect(navLink(screen, 'Files')?.getAttribute('aria-current')).toBeNull();
	});

	it('defaults the active tab to Files for the library base path', () => {
		const screen = render(SidebarLibraryNav, {
			props: {
				libraries: [lib({ id: 'def', isDefault: true })],
				user: owner,
				currentPath: '/libraries/def'
			}
		});
		expect(navLink(screen, 'Files')?.getAttribute('aria-current')).toBe('page');
	});

	it('renders nothing in the section nav when there are no libraries', () => {
		const screen = render(SidebarLibraryNav, {
			props: { libraries: [], user: owner }
		});
		// No library means no section links; Admin still shows for owners.
		const labels = navLabels(screen);
		expect(labels).not.toContain('Files');
		expect(labels).toContain('Admin');
	});

	it('shows a load-error notice (distinct from "no libraries") when librariesError is set', () => {
		const failed = render(SidebarLibraryNav, {
			props: { libraries: [], user: owner, librariesError: true }
		});
		expect(failed.container.textContent).toContain("Couldn't load your libraries");

		// A genuinely-empty (but successful) load shows no error notice.
		const empty = render(SidebarLibraryNav, {
			props: { libraries: [], user: owner }
		});
		expect(empty.container.textContent).not.toContain("Couldn't load your libraries");
	});

	it('re-emits create from the switcher via oncreate', async () => {
		const oncreate = vi.fn();
		const screen = render(SidebarLibraryNav, {
			props: { libraries: [lib({ isDefault: true })], user: owner, oncreate }
		});
		// Open the switcher popover, then click its "New library" action.
		const trigger = screen.container.querySelector('button[aria-haspopup]') as HTMLButtonElement;
		expect(trigger).not.toBeNull();
		trigger.click();
		await vi.waitFor(() => {
			const createBtn = Array.from(screen.container.querySelectorAll('button')).find((b) =>
				b.textContent?.includes('New library')
			);
			expect(createBtn).toBeTruthy();
		});
		const createBtn = Array.from(screen.container.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('New library')
		) as HTMLButtonElement;
		createBtn.click();
		expect(oncreate).toHaveBeenCalledOnce();
	});
});
