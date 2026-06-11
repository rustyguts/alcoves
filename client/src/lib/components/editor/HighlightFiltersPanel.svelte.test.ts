import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import HighlightFiltersPanel from './HighlightFiltersPanel.svelte';
import type { HighlightFilter } from '$lib/types/api';
import type { FilterAggregate, FilterMatch } from '$lib/state/editor-highlights.svelte';

function makeFilter(over: Partial<HighlightFilter>): HighlightFilter {
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

const buttons = (screen: ReturnType<typeof renderPanel>) => [
	...screen.container.querySelectorAll('button')
];

const findButtonByText = (screen: ReturnType<typeof renderPanel>, text: string) =>
	buttons(screen).find((b) => b.textContent?.trim() === text);

const findButtonByLabel = (screen: ReturnType<typeof renderPanel>, label: string) =>
	buttons(screen).find((b) => b.getAttribute('aria-label') === label);

/** Click the collapsible header toggle (the first button) and wait for the toolbar. */
async function open(screen: ReturnType<typeof renderPanel>) {
	buttons(screen)[0]!.click();
	await expect.element(screen.getByRole('button', { name: 'Add filter' })).toBeInTheDocument();
}

describe('HighlightFiltersPanel', () => {
	it('renders nothing without signals and without filters', () => {
		const screen = renderPanel({ hasSignals: false, filters: [] });
		expect(screen.container.textContent?.trim()).toBe('');
	});

	it('renders when there are signals, collapsed by default', () => {
		const screen = renderPanel();
		expect(screen.container.textContent).toContain('Highlight filters');
		expect(screen.container.textContent).not.toContain('Add filter');
	});

	it('expands to reveal the toolbar', async () => {
		const screen = renderPanel();
		await open(screen);
		expect(findButtonByText(screen, 'Add filter')).toBeTruthy();
	});

	it('shows Load presets only when there are no filters and fires onloadpresets', async () => {
		const onloadpresets = vi.fn();
		const screen = renderPanel({ filters: [], onloadpresets });
		await open(screen);
		const presets = findButtonByText(screen, 'Load presets');
		expect(presets).toBeTruthy();
		presets!.click();
		expect(onloadpresets).toHaveBeenCalledTimes(1);
	});

	it('hides Load presets once filters exist', async () => {
		const screen = renderPanel({ filters: [makeFilter({ id: 'a' })], aggregates: { a: agg() } });
		await open(screen);
		expect(findButtonByText(screen, 'Load presets')).toBeUndefined();
	});

	it('opens the add form and fires oncreate with trimmed values', async () => {
		const oncreate = vi.fn();
		const screen = renderPanel({ oncreate });
		await open(screen);
		findButtonByText(screen, 'Add filter')!.click();
		await expect.element(screen.getByPlaceholder('Funny clip')).toBeInTheDocument();
		const inputs = screen.container.querySelectorAll('input');
		const setVal = (el: HTMLInputElement, v: string) => {
			el.value = v;
			el.dispatchEvent(new Event('input', { bubbles: true }));
		};
		setVal(inputs[0] as HTMLInputElement, '  Funny  ');
		setVal(inputs[1] as HTMLInputElement, '  laughter  ');
		findButtonByText(screen, 'Save')!.click();
		expect(oncreate).toHaveBeenCalledWith({
			name: 'Funny',
			expression: 'laughter',
			proximitySeconds: 5,
			color: '#3B82F6'
		});
	});

	it('does not fire oncreate when name or expression is blank', async () => {
		const oncreate = vi.fn();
		const screen = renderPanel({ oncreate });
		await open(screen);
		findButtonByText(screen, 'Add filter')!.click();
		await expect.element(screen.getByPlaceholder('Funny clip')).toBeInTheDocument();
		findButtonByText(screen, 'Save')!.click();
		expect(oncreate).not.toHaveBeenCalled();
	});

	it('cancels the add form', async () => {
		const screen = renderPanel();
		await open(screen);
		findButtonByText(screen, 'Add filter')!.click();
		await expect.element(screen.getByPlaceholder('Funny clip')).toBeInTheDocument();
		findButtonByText(screen, 'Cancel')!.click();
		await expect.element(screen.getByText('No filters yet', { exact: false })).toBeInTheDocument();
	});

	it('sorts filters by hit count then name', async () => {
		const filters = [
			makeFilter({ id: 'a', name: 'Alpha' }),
			makeFilter({ id: 'b', name: 'Bravo' })
		];
		const screen = renderPanel({
			filters,
			aggregates: { a: agg({ count: 1 }), b: agg({ count: 5 }) }
		});
		await open(screen);
		const nameSpans = [...screen.container.querySelectorAll('li span.font-medium')].map((s) =>
			s.textContent?.trim()
		);
		expect(nameSpans).toEqual(['Bravo', 'Alpha']);
	});

	it('shows aggregate hit stats', async () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg({ count: 3, meanScore: 0.5, maxScore: 0.9 }) }
		});
		await open(screen);
		const text = screen.container.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(text).toContain('3 hits');
		expect(text).toContain('avg 50%');
		expect(text).toContain('max 90%');
	});

	it('flags a parse error from the aggregate', async () => {
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg({ expressionErrors: ['bad token'] }) }
		});
		await open(screen);
		expect(screen.container.textContent).toContain('parse error');
	});

	it('expands a filter to show matches and fires onseek on click', async () => {
		const onseek = vi.fn();
		const matches: Record<string, FilterMatch[]> = {
			a: [{ filterId: 'a', startSeconds: 65, endSeconds: 67, score: 0.8, evidence: ['laughter'] }]
		};
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			matches,
			aggregates: { a: agg({ count: 1 }) },
			onseek
		});
		await open(screen);
		// the per-filter expand toggle is the first button inside the row
		(screen.container.querySelector('li button') as HTMLButtonElement).click();
		await expect.element(screen.getByText('1:05', { exact: false })).toBeInTheDocument();
		const matchBtn = [...screen.container.querySelectorAll('li button')].find((b) =>
			b.textContent?.includes('1:05')
		);
		expect(matchBtn).toBeTruthy();
		(matchBtn as HTMLButtonElement).click();
		expect(onseek).toHaveBeenCalledWith(65);
	});

	it('opens the edit form and fires onupdate', async () => {
		const onupdate = vi.fn();
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a', name: 'Orig', expression: 'laughter' })],
			aggregates: { a: agg() },
			onupdate
		});
		await open(screen);
		findButtonByLabel(screen, 'Edit filter')!.click();
		await expect.element(screen.getByText('Expression')).toBeInTheDocument();
		const nameInput = screen.container.querySelector('input') as HTMLInputElement;
		nameInput.value = 'Updated';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		findButtonByText(screen, 'Save')!.click();
		expect(onupdate).toHaveBeenCalledTimes(1);
		expect(onupdate.mock.calls[0]![0]).toBe('a');
		expect((onupdate.mock.calls[0]![1] as { name: string }).name).toBe('Updated');
	});

	it('cancels the edit form', async () => {
		const onupdate = vi.fn();
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a', name: 'Orig' })],
			aggregates: { a: agg() },
			onupdate
		});
		await open(screen);
		findButtonByLabel(screen, 'Edit filter')!.click();
		await expect.element(screen.getByText('Expression')).toBeInTheDocument();
		findButtonByText(screen, 'Cancel')!.click();
		expect(onupdate).not.toHaveBeenCalled();
	});

	it('fires onremove when the trash button is clicked', async () => {
		const onremove = vi.fn();
		const screen = renderPanel({
			filters: [makeFilter({ id: 'a' })],
			aggregates: { a: agg() },
			onremove
		});
		await open(screen);
		findButtonByLabel(screen, 'Remove filter')!.click();
		expect(onremove).toHaveBeenCalledWith('a');
	});
});
