import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import HighlightFiltersPanel from './HighlightFiltersPanel.svelte';
import type { HighlightFilter } from '$lib/types/api';
import type { FilterAggregate, FilterMatch } from '$lib/state/editor-highlights.svelte';

function makeFilter(over: Partial<HighlightFilter> = {}): HighlightFilter {
	return {
		id: 'f1',
		libraryId: 'lib1',
		createdById: null,
		name: 'Filter',
		expression: 'laughter:25',
		proximitySeconds: 5,
		color: '#3B82F6',
		createdAt: '',
		updatedAt: '',
		...over
	};
}

const agg = (over: Partial<FilterAggregate> = {}): FilterAggregate => ({
	count: 0,
	meanScore: 0,
	maxScore: 0,
	expressionErrors: [],
	...over
});

function renderPanel(over: Record<string, unknown> = {}) {
	return render(HighlightFiltersPanel, {
		props: {
			filters: [],
			matches: {},
			aggregates: {},
			hasSignals: true,
			...over
		}
	});
}

type Screen = ReturnType<typeof renderPanel>;

const buttons = (screen: Screen) => [...screen.container.querySelectorAll('button')];

const findButtonByText = (screen: Screen, text: string) =>
	buttons(screen).find((b) => b.textContent?.trim() === text);

const findButtonByLabel = (screen: Screen, label: string) =>
	buttons(screen).find((b) => b.getAttribute('aria-label') === label);

function setVal(el: Element | null, value: string) {
	const input = el as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openAddForm(screen: Screen) {
	findButtonByText(screen, 'Add filter')!.click();
	await expect.element(screen.getByPlaceholder('Funny clip')).toBeInTheDocument();
}

describe('HighlightFiltersPanel', () => {
	it('always renders the header with the filter count badge and DSL help title', () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' }), makeFilter({ id: 'b', name: 'B' })]
		});
		const badge = screen.container.querySelector('[data-slot="badge"]');
		expect(badge?.textContent?.trim()).toBe('2');
		const help = screen.container.querySelector('span[title]');
		expect(help?.getAttribute('title')).toContain('Comma = OR');
		expect(help?.getAttribute('title')).toContain(':25 = min %');
	});

	it('renders the toolbar even without signals (no self-hiding)', () => {
		const screen = renderPanel({ hasSignals: false, filters: [] });
		expect(findButtonByText(screen, 'Add filter')).toBeTruthy();
		expect(screen.container.textContent).toContain('first to give filters something to match');
	});

	it('hides the no-signals hint while adding or when signals exist', async () => {
		const screen = renderPanel({ hasSignals: false, filters: [] });
		await openAddForm(screen);
		expect(screen.container.textContent).not.toContain('first to give filters something to match');

		const withSignals = renderPanel({ hasSignals: true, filters: [] });
		expect(withSignals.container.textContent).not.toContain(
			'first to give filters something to match'
		);
	});

	it('shows Load presets only when there are no filters and fires onloadpresets', () => {
		const onloadpresets = vi.fn();
		const screen = renderPanel({ filters: [], onloadpresets });
		const presets = findButtonByText(screen, 'Load presets');
		expect(presets).toBeTruthy();
		presets!.click();
		expect(onloadpresets).toHaveBeenCalledTimes(1);
	});

	it('hides Load presets once filters exist', () => {
		const screen = renderPanel({ filters: [makeFilter({ id: 'a' })], aggregates: { a: agg() } });
		expect(findButtonByText(screen, 'Load presets')).toBeUndefined();
	});

	it('disables Load presets with a busy spinner while loading', () => {
		const screen = renderPanel({ filters: [], loading: true });
		const presets = findButtonByText(screen, 'Load presets') as HTMLButtonElement;
		expect(presets.disabled).toBe(true);
		expect(presets.getAttribute('aria-busy')).toBe('true');
	});

	it('opens the add form and fires oncreate with the trimmed draft', async () => {
		const oncreate = vi.fn();
		const screen = renderPanel({ oncreate });
		await openAddForm(screen);
		setVal(screen.container.querySelector('#hf-add-name'), '  Funny  ');
		setVal(screen.container.querySelector('#hf-add-expr'), '  laughter  ');
		setVal(screen.container.querySelector('#hf-add-prox'), '12');
		setVal(screen.container.querySelector('#hf-add-color'), '#ff0000');
		await tick();
		const proxLabel = screen.container.querySelector('label[for="hf-add-prox"]');
		expect(proxLabel?.textContent?.replace(/\s+/g, ' ').trim()).toBe('AND ± 12s');
		findButtonByText(screen, 'Save')!.click();
		expect(oncreate).toHaveBeenCalledWith({
			name: 'Funny',
			expression: 'laughter',
			proximitySeconds: 12,
			color: '#ff0000'
		});
		// Submit closes + resets the form.
		await expect.element(screen.getByText('No filters yet', { exact: false })).toBeInTheDocument();
	});

	it('does not fire oncreate when the name or expression is blank', async () => {
		const oncreate = vi.fn();
		const screen = renderPanel({ oncreate });
		await openAddForm(screen);
		findButtonByText(screen, 'Save')!.click();
		expect(oncreate).not.toHaveBeenCalled();

		setVal(screen.container.querySelector('#hf-add-name'), 'Named');
		setVal(screen.container.querySelector('#hf-add-expr'), '   ');
		await tick();
		findButtonByText(screen, 'Save')!.click();
		expect(oncreate).not.toHaveBeenCalled();
		// The form stays open after a rejected submit.
		expect(screen.container.querySelector('#hf-add-name')).not.toBeNull();
	});

	it('cancel closes the add form and resets the draft', async () => {
		const screen = renderPanel();
		await openAddForm(screen);
		setVal(screen.container.querySelector('#hf-add-name'), 'Discard me');
		await tick();
		findButtonByText(screen, 'Cancel')!.click();
		await expect.element(screen.getByText('No filters yet', { exact: false })).toBeInTheDocument();

		await openAddForm(screen);
		const name = screen.container.querySelector('#hf-add-name') as HTMLInputElement;
		expect(name.value).toBe('');
	});

	it('pre-fills the edit form and fires onupdate with the id and body', async () => {
		const onupdate = vi.fn();
		const screen = renderPanel({
			filters: [
				makeFilter({
					id: 'a',
					name: 'Orig',
					expression: 'laughter:25',
					proximitySeconds: 7,
					color: '#112233'
				})
			],
			aggregates: { a: agg() },
			onupdate
		});
		findButtonByLabel(screen, 'Edit filter')!.click();
		await expect.element(screen.getByText('Expression')).toBeInTheDocument();
		expect((screen.container.querySelector('#hf-edit-name') as HTMLInputElement).value).toBe(
			'Orig'
		);
		expect((screen.container.querySelector('#hf-edit-expr') as HTMLInputElement).value).toBe(
			'laughter:25'
		);
		const proxLabel = screen.container.querySelector('label[for="hf-edit-prox"]');
		expect(proxLabel?.textContent?.replace(/\s+/g, ' ').trim()).toBe('AND ± 7s');

		setVal(screen.container.querySelector('#hf-edit-name'), '  Updated  ');
		await tick();
		findButtonByText(screen, 'Save')!.click();
		expect(onupdate).toHaveBeenCalledWith('a', {
			name: 'Updated',
			expression: 'laughter:25',
			proximitySeconds: 7,
			color: '#112233'
		});
		// Submit leaves edit mode.
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#hf-edit-name')).toBeNull();
		});
	});

	it('does not fire onupdate when the edited draft is blanked', async () => {
		const onupdate = vi.fn();
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg() },
			onupdate
		});
		findButtonByLabel(screen, 'Edit filter')!.click();
		await expect.element(screen.getByText('Expression')).toBeInTheDocument();
		setVal(screen.container.querySelector('#hf-edit-name'), '');
		await tick();
		findButtonByText(screen, 'Save')!.click();
		expect(onupdate).not.toHaveBeenCalled();
	});

	it('cancel closes the edit form without firing onupdate', async () => {
		const onupdate = vi.fn();
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a', name: 'Orig' })],
			aggregates: { a: agg() },
			onupdate
		});
		findButtonByLabel(screen, 'Edit filter')!.click();
		await expect.element(screen.getByText('Expression')).toBeInTheDocument();
		findButtonByText(screen, 'Cancel')!.click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#hf-edit-name')).toBeNull();
		});
		expect(onupdate).not.toHaveBeenCalled();
	});

	it('add and edit forms are mutually exclusive', async () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg() }
		});
		findButtonByLabel(screen, 'Edit filter')!.click();
		await expect.element(screen.getByText('Expression')).toBeInTheDocument();
		// Opening the add form closes the edit form.
		findButtonByText(screen, 'Add filter')!.click();
		await expect.element(screen.getByPlaceholder('Funny clip')).toBeInTheDocument();
		expect(screen.container.querySelector('#hf-edit-name')).toBeNull();
		// And opening the edit form closes the add form again.
		findButtonByLabel(screen, 'Edit filter')!.click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#hf-edit-name')).not.toBeNull();
		});
		expect(screen.container.querySelector('#hf-add-name')).toBeNull();
	});

	it('fires onremove immediately with no confirmation dialog', () => {
		const onremove = vi.fn();
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg() },
			onremove
		});
		findButtonByLabel(screen, 'Remove filter')!.click();
		expect(onremove).toHaveBeenCalledWith('a');
		expect(onremove).toHaveBeenCalledTimes(1);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it('sorts filters by hit count desc, then name', () => {
		const filters = [
			makeFilter({ id: 'a', name: 'Bravo' }),
			makeFilter({ id: 'b', name: 'Charlie' }),
			makeFilter({ id: 'c', name: 'Alpha' })
		];
		const screen = renderPanel({
			filters,
			aggregates: { a: agg({ count: 1 }), b: agg({ count: 5 }), c: agg({ count: 1 }) }
		});
		const names = [...screen.container.querySelectorAll('li span.truncate.font-medium')].map((s) =>
			s.textContent?.trim()
		);
		expect(names).toEqual(['Charlie', 'Alpha', 'Bravo']);
	});

	it('uses a tonal-primary hits badge only when there are hits', () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a', name: 'Hit' }), makeFilter({ id: 'b', name: 'Miss' })],
			aggregates: { a: agg({ count: 3 }), b: agg({ count: 0 }) }
		});
		const hitBadges = [...screen.container.querySelectorAll('[data-slot="badge"]')].filter((b) =>
			b.textContent?.includes('hits')
		);
		expect(hitBadges).toHaveLength(2);
		expect(hitBadges[0]!.textContent?.trim()).toBe('3 hits');
		expect(hitBadges[0]!.className).toContain('bg-primary/10');
		expect(hitBadges[1]!.textContent?.trim()).toBe('0 hits');
		expect(hitBadges[1]!.className).not.toContain('bg-primary/10');
	});

	it('shows the avg/max score line only for filters with hits', () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a', name: 'Hit' }), makeFilter({ id: 'b', name: 'Miss' })],
			aggregates: { a: agg({ count: 3, meanScore: 0.5, maxScore: 0.9 }), b: agg() }
		});
		const text = screen.container.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(text).toContain('avg 50% · max 90%');
		expect(text.match(/avg /g)).toHaveLength(1);
	});

	it('flags a parse error with the joined errors as the badge title', () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg({ expressionErrors: ['bad token', 'also bad'] }) }
		});
		const badge = [...screen.container.querySelectorAll('[data-slot="badge"]')].find(
			(b) => b.textContent?.trim() === 'parse error'
		);
		expect(badge).toBeTruthy();
		expect(badge?.getAttribute('title')).toBe('bad token; also bad');
	});

	it('expands a row to show match chips that fire onseek', async () => {
		const onseek = vi.fn();
		const matches: Record<string, FilterMatch[]> = {
			a: [
				{
					filterId: 'a',
					startSeconds: 65,
					endSeconds: 67,
					score: 0.8,
					evidence: ['laughter', 'word:ha']
				},
				{ filterId: 'a', startSeconds: -2, endSeconds: 0, score: 0.4, evidence: ['clap'] }
			]
		};
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			matches,
			aggregates: { a: agg({ count: 2 }) },
			onseek
		});
		// The expand toggle is the first button of the row.
		(screen.container.querySelector('li button') as HTMLButtonElement).click();
		await expect.element(screen.getByText('1:05', { exact: false })).toBeInTheDocument();
		const chips = [...screen.container.querySelectorAll<HTMLButtonElement>('li li button')];
		expect(chips).toHaveLength(2);
		expect(chips[0]!.getAttribute('title')).toBe('"laughter" + "word:ha"');
		expect(chips[0]!.textContent?.replace(/\s+/g, ' ')).toContain('· 80%');
		expect(chips[0]!.textContent).toContain('"laughter" + "word:ha"');
		// Negative start clamps the time label to 0:00.
		expect(chips[1]!.textContent).toContain('0:00');
		chips[0]!.click();
		expect(onseek).toHaveBeenCalledWith(65);

		// Clicking the toggle again collapses the chips.
		(screen.container.querySelector('li button') as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('li li button')).toBeNull();
		});
	});

	it('renders no chip list when an expanded filter has no matches', async () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg() }
		});
		(screen.container.querySelector('li button') as HTMLButtonElement).click();
		await tick();
		expect(screen.container.querySelectorAll('li ul')).toHaveLength(0);
	});

	it('shows the empty-list message when there are no filters and the form is closed', async () => {
		const screen = renderPanel({ filters: [] });
		expect(screen.container.textContent).toContain('No filters yet');
		await openAddForm(screen);
		expect(screen.container.textContent).not.toContain('No filters yet');
	});
});
