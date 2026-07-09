import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MomentsList from './MomentsList.svelte';
import type { Moment } from '$lib/types/api';

function makeMoment(over: Partial<Moment> = {}): Moment {
	return {
		id: 'm1',
		fileId: 'file1',
		libraryId: 'lib1',
		createdById: 'u1',
		name: 'Clip',
		description: '',
		startSeconds: 1,
		endSeconds: 2.5,
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
	};
}

function cards(container: ParentNode): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>("[role='button']"));
}

describe('MomentsList', () => {
	it('shows the empty state when there are no moments', async () => {
		const screen = render(MomentsList, { props: { moments: [], selectedId: null } });
		await expect.element(screen.getByText('No moments yet')).toBeInTheDocument();
		expect(screen.container.textContent).toContain('Mark a time range to clip');
		expect(screen.container.querySelector('[data-testid="moments-list"]')).toBeNull();
	});

	it('fires oncreate from the New moment CTA', async () => {
		const oncreate = vi.fn();
		const screen = render(MomentsList, { props: { moments: [], selectedId: null, oncreate } });
		await screen.getByRole('button', { name: /new moment/i }).click();
		expect(oncreate).toHaveBeenCalledTimes(1);
	});

	it('does not throw when the CTA fires without an oncreate callback', () => {
		const screen = render(MomentsList, { props: { moments: [], selectedId: null } });
		const cta = Array.from(screen.container.querySelectorAll('button')).find((b) =>
			b.textContent?.includes('New moment')
		)!;
		expect(() => cta.click()).not.toThrow();
	});

	it('renders moments sorted by startSeconds', () => {
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
	});

	it('shows the timecode range and clip length', () => {
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ startSeconds: 1, endSeconds: 2.5 })], selectedId: null }
		});
		expect(screen.container.textContent).toContain('0:01.0 – 0:02.5');
		expect(screen.container.textContent).toContain('1.50s');
	});

	it("falls back to 'Untitled' when a moment has no name", () => {
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ name: '' })], selectedId: null }
		});
		expect(screen.container.textContent).toContain('Untitled');
	});

	it('fires onselect with the moment id on click', () => {
		const onselect = vi.fn();
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ id: 'abc' })], selectedId: null, onselect }
		});
		cards(screen.container)[0]!.click();
		expect(onselect).toHaveBeenCalledTimes(1);
		expect(onselect).toHaveBeenCalledWith('abc');
	});

	it.each([
		['Enter', 'Enter'],
		['Space', ' ']
	])('selects and prevents default on %s keydown', (_label, key) => {
		const onselect = vi.fn();
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ id: 'kbd' })], selectedId: null, onselect }
		});
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		cards(screen.container)[0]!.dispatchEvent(event);
		expect(onselect).toHaveBeenCalledWith('kbd');
		expect(event.defaultPrevented).toBe(true);
	});

	it('ignores unrelated keys on the card', () => {
		const onselect = vi.fn();
		const screen = render(MomentsList, {
			props: { moments: [makeMoment()], selectedId: null, onselect }
		});
		const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
		cards(screen.container)[0]!.dispatchEvent(event);
		expect(onselect).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it.each([
		// Null status: statusBadge returns class '' so the Badge's own
		// `variant="secondary"` tint (bg-secondary) survives cn()/twMerge —
		// pin that exact class instead of skipping the assertion, so a
		// wrong-tint regression in the default branch still fails.
		[null, null, '—', 'bg-secondary'],
		['queued', null, 'queued', 'bg-warning/10'],
		['ready', null, 'ready', 'bg-success/10'],
		['failed', null, 'failed', 'bg-destructive/10'],
		['processing', null, 'processing', 'bg-warning/10'],
		['processing', 42, '42%', 'bg-warning/10']
	] as Array<[Moment['exportStatus'], number | null, string, string]>)(
		'renders the %s (progress %s) status badge as %s',
		(exportStatus, exportProgress, label, tint) => {
			const screen = render(MomentsList, {
				props: { moments: [makeMoment({ exportStatus, exportProgress })], selectedId: null }
			});
			const badge = screen.container.querySelector('[data-slot="badge"]')!;
			expect(badge.textContent!.trim()).toBe(label);
			expect(badge.className).toContain(tint);
		}
	);

	it('highlights the selected moment card and not its siblings', () => {
		const screen = render(MomentsList, {
			props: {
				moments: [
					makeMoment({ id: 'sel' }),
					makeMoment({ id: 'other', startSeconds: 5, endSeconds: 6 })
				],
				selectedId: 'sel'
			}
		});
		const [selected, other] = cards(screen.container);
		expect(selected!.className).toContain('bg-primary/10');
		expect(selected!.className).toContain('ring-primary');
		expect(other!.className).toContain('bg-muted');
		expect(other!.className).not.toContain('bg-primary/10');
	});

	it('fires onjumpto from the Jump button without selecting (stopPropagation)', async () => {
		const onselect = vi.fn();
		const onjumpto = vi.fn();
		const screen = render(MomentsList, {
			props: { moments: [makeMoment({ id: 'jmp' })], selectedId: null, onselect, onjumpto }
		});
		await screen.getByRole('button', { name: 'Jump to start of Clip', exact: true }).click();
		expect(onjumpto).toHaveBeenCalledWith('jmp');
		expect(onselect).not.toHaveBeenCalled();
	});

	it('is safe to interact without onselect/onjumpto callbacks', () => {
		const screen = render(MomentsList, { props: { moments: [makeMoment()], selectedId: null } });
		expect(() => {
			cards(screen.container)[0]!.click();
			screen.container.querySelector<HTMLButtonElement>("[title='Jump to start']")!.click();
		}).not.toThrow();
	});
});
