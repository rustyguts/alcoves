import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MomentsList from './MomentsList.svelte';
import type { Moment } from '$lib/types/api';

function makeMoment(over: Partial<Moment>): Moment {
	return {
		id: 'm1',
		libraryId: 'lib1',
		fileId: 'file1',
		createdById: 'u1',
		name: 'Clip',
		description: '',
		startSeconds: 0,
		endSeconds: 1,
		exportStatus: null,
		exportProgress: null,
		exportEtaSeconds: null,
		exportVersion: 0,
		exportedVersion: null,
		trashedAt: null,
		createdAt: '',
		updatedAt: '',
		tags: [],
		...over
	} as Moment;
}

describe('MomentsList', () => {
	it('shows an empty state when there are no moments', () => {
		const screen = render(MomentsList, { props: { moments: [], selectedId: null } });
		expect(screen.container.textContent).toContain('No moments yet');
	});

	it('renders moments sorted by startSeconds with a count', () => {
		const screen = render(MomentsList, {
			props: {
				moments: [
					makeMoment({ id: 'late', name: 'Late', startSeconds: 10, endSeconds: 12 }),
					makeMoment({ id: 'early', name: 'Early', startSeconds: 1, endSeconds: 2 })
				],
				selectedId: null
			}
		});
		const items = screen.container.querySelectorAll('li');
		expect(items).toHaveLength(2);
		expect(items[0]!.textContent).toContain('Early');
		expect(items[1]!.textContent).toContain('Late');
		expect(screen.container.querySelector('header')!.textContent).toContain('2');
	});

	it('shows the duration and range for a moment', () => {
		const screen = render(MomentsList, {
			props: {
				moments: [makeMoment({ startSeconds: 1.2, endSeconds: 3.7 })],
				selectedId: null
			}
		});
		expect(screen.container.textContent).toContain('1.2s – 3.7s');
		expect(screen.container.textContent).toContain('2.50s');
	});

	it("falls back to 'Untitled' when a moment has no name", () => {
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ name: '' })], selectedId: null }
		});
		expect(screen.container.textContent).toContain('Untitled');
	});

	it('fires onselect with the moment id on click', async () => {
		const onselect = vi.fn();
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ id: 'abc' })], selectedId: null, onselect }
		});
		screen.container.querySelector<HTMLElement>("[role='button']")!.click();
		expect(onselect).toHaveBeenCalledTimes(1);
		expect(onselect).toHaveBeenCalledWith('abc');
	});

	it('fires onselect when Enter is pressed on a moment card', async () => {
		const onselect = vi.fn();
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ id: 'kbd' })], selectedId: null, onselect }
		});
		const card = screen.container.querySelector<HTMLElement>("[role='button']")!;
		card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onselect).toHaveBeenCalledWith('kbd');
	});

	it.each([
		['queued', 'queued'],
		['ready', 'ready'],
		['failed', 'failed']
	] as const)('renders the %s status badge', (status, label) => {
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ exportStatus: status })], selectedId: null }
		});
		expect(screen.container.querySelector('.badge')!.textContent).toContain(label);
	});

	it('renders processing progress percentage when available', () => {
		const screen = render(MomentsList, {
			props: {
				moments: [makeMoment({ exportStatus: 'processing', exportProgress: 42 })],
				selectedId: null
			}
		});
		expect(screen.container.textContent).toContain('42%');
	});

	it('renders a dash when there is no export status', () => {
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ exportStatus: null })], selectedId: null }
		});
		expect(screen.container.querySelector('.badge')!.textContent).toContain('—');
	});

	it('highlights the selected moment', () => {
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ id: 'sel' })], selectedId: 'sel' }
		});
		const card = screen.container.querySelector<HTMLElement>("[role='button']")!;
		expect(card.className).toContain('ring-primary-500');
		expect(card.className).toContain('preset-tonal-primary');
	});
});
