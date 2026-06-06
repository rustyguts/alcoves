import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MomentEditForm from './MomentEditForm.svelte';
import type { Moment } from '$lib/types/api';

function makeMoment(over: Partial<Moment> = {}): Moment {
	return {
		id: 'm1',
		libraryId: 'lib1',
		fileId: 'file1',
		name: 'Clip',
		description: 'notes',
		startSeconds: 1,
		endSeconds: 3,
		exportStatus: null,
		tags: [],
		...over
	} as Moment;
}

function baseProps(over: Record<string, unknown> = {}) {
	return { moment: makeMoment(), duration: 10, ...over };
}

function findButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll('button')).find((b) =>
		b.textContent?.includes(label)
	) as HTMLButtonElement | undefined;
}

function inputs(container: ParentNode): HTMLInputElement[] {
	return Array.from(container.querySelectorAll('input'));
}

describe('MomentEditForm', () => {
	it('renders nothing when there is no moment', () => {
		const screen = render(MomentEditForm, {
			props: { moment: null, duration: 10 }
		});
		expect(screen.container.textContent?.trim()).toBe('');
	});

	it('populates fields from the moment', () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		const name = screen.container.querySelector('#moment-name') as HTMLInputElement;
		const description = screen.container.querySelector(
			'#moment-description'
		) as HTMLTextAreaElement;
		expect(name.value).toBe('Clip');
		expect(description.value).toBe('notes');
	});

	it('re-populates when a different moment is loaded', async () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		await screen.rerender({
			...baseProps({ moment: makeMoment({ id: 'm2', name: 'Renamed' }) })
		});
		const name = screen.container.querySelector('#moment-name') as HTMLInputElement;
		expect(name.value).toBe('Renamed');
	});

	it('fires onsave with the current field values', () => {
		const onsave = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onsave }) });
		findButton(screen.container, 'Save')?.click();
		expect(onsave).toHaveBeenCalledWith({
			name: 'Clip',
			description: 'notes',
			startSeconds: 1,
			endSeconds: 3
		});
	});

	it('clamps start >= 0 and end > start on save', async () => {
		const onsave = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onsave }) });
		// number inputs: [start, end] (name is a text input)
		const numberInputs = inputs(screen.container).filter((i) => i.type === 'number');
		const [start, end] = numberInputs;
		start.value = '-5';
		start.dispatchEvent(new Event('input', { bubbles: true }));
		end.value = '0';
		end.dispatchEvent(new Event('input', { bubbles: true }));

		findButton(screen.container, 'Save')?.click();
		const patch = onsave.mock.calls[0][0] as { startSeconds: number; endSeconds: number };
		expect(patch.startSeconds).toBe(0);
		expect(patch.endSeconds).toBeCloseTo(0.001);
	});

	it('fires ondelete with the moment id', () => {
		const ondelete = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ ondelete }) });
		findButton(screen.container, 'Delete')?.click();
		expect(ondelete).toHaveBeenCalledWith('m1');
	});

	it('fires export/download/share/close from the header actions', () => {
		const onexport = vi.fn();
		const ondownload = vi.fn();
		const onshare = vi.fn();
		const onclose = vi.fn();
		const screen = render(MomentEditForm, {
			props: baseProps({ onexport, ondownload, onshare, onclose })
		});
		findButton(screen.container, 'Reprocess')?.click();
		(screen.container.querySelector("[title='Download']") as HTMLButtonElement)?.click();
		(screen.container.querySelector("[title='Share']") as HTMLButtonElement)?.click();
		(screen.container.querySelector("[aria-label='Close']") as HTMLButtonElement)?.click();
		expect(onexport).toHaveBeenCalledWith('m1');
		expect(ondownload).toHaveBeenCalledWith('m1');
		expect(onshare).toHaveBeenCalledWith('m1');
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('fires onsetToPlayhead for start and end', () => {
		const onsetToPlayhead = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onsetToPlayhead }) });
		const snaps = Array.from(
			screen.container.querySelectorAll("[title='Set to playhead']")
		) as HTMLButtonElement[];
		snaps[0]?.click();
		snaps[1]?.click();
		expect(onsetToPlayhead.mock.calls).toEqual([['start'], ['end']]);
	});

	it('disables reprocess while an export is in flight', () => {
		const screen = render(MomentEditForm, {
			props: baseProps({ moment: makeMoment({ exportStatus: 'processing' }) })
		});
		expect(findButton(screen.container, 'Reprocess')?.disabled).toBe(true);
	});

	it('shows a spinner on the download action when downloadPending', () => {
		const screen = render(MomentEditForm, { props: baseProps({ downloadPending: true }) });
		const download = screen.container.querySelector("[title='Download']") as HTMLButtonElement;
		expect(download.disabled).toBe(true);
		expect(download.querySelector('.animate-spin')).not.toBeNull();
	});
});
