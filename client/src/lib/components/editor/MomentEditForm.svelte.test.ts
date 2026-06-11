import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import MomentEditForm from './MomentEditForm.svelte';
import type { Moment } from '$lib/types/api';

function makeMoment(over: Partial<Moment> = {}): Moment {
	return {
		id: 'm1',
		fileId: 'file1',
		libraryId: 'lib1',
		createdById: 'u1',
		name: 'Clip',
		description: 'notes',
		startSeconds: 1,
		endSeconds: 3,
		exportStatus: null,
		exportProgress: null,
		exportEtaSeconds: null,
		exportVersion: 1,
		exportedVersion: null,
		trashedAt: null,
		createdAt: '',
		updatedAt: '',
		tags: [],
		...over
	};
}

function baseProps(over: Record<string, unknown> = {}) {
	return { moment: makeMoment(), duration: 10, ...over };
}

function findButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll('button')).find((b) =>
		b.textContent?.includes(label)
	);
}

function field<T extends HTMLInputElement | HTMLTextAreaElement>(
	container: ParentNode,
	id: string
): T {
	return container.querySelector<T>(`#${id}`)!;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('MomentEditForm', () => {
	it('renders nothing when there is no moment', () => {
		const screen = render(MomentEditForm, { props: { moment: null, duration: 10 } });
		expect(screen.container.textContent?.trim()).toBe('');
		expect(screen.container.querySelector('[data-testid="moment-edit-form"]')).toBeNull();
	});

	it('populates the fields from the moment', () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		expect(field<HTMLInputElement>(screen.container, 'moment-name').value).toBe('Clip');
		expect(field<HTMLTextAreaElement>(screen.container, 'moment-description').value).toBe('notes');
		expect(field<HTMLInputElement>(screen.container, 'moment-start').value).toBe('1');
		expect(field<HTMLInputElement>(screen.container, 'moment-end').value).toBe('3');
	});

	it('keeps a user-edited field when the same moment id rerenders with new values', async () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		const name = field<HTMLInputElement>(screen.container, 'moment-name');
		setValue(name, 'My edit');
		// Same id, new field values — e.g. the 2s export poll churning the object.
		await screen.rerender(
			baseProps({ moment: makeMoment({ name: 'Poll churn', startSeconds: 2 }) })
		);
		await tick();
		expect(name.value).toBe('My edit');
	});

	it('adopts new server values for untouched fields on a same-id rerender', async () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		setValue(field<HTMLInputElement>(screen.container, 'moment-name'), 'My edit');
		// An external range commit (I/O keys, set-to-playhead, timeline drag)
		// lands on the SAME id — fields the user never touched must follow it
		// while the in-progress name edit sticks.
		await screen.rerender(
			baseProps({ moment: makeMoment({ name: 'Server rename', startSeconds: 2, endSeconds: 5 }) })
		);
		await tick();
		expect(field<HTMLInputElement>(screen.container, 'moment-name').value).toBe('My edit');
		expect(field<HTMLInputElement>(screen.container, 'moment-start').value).toBe('2');
		expect(field<HTMLInputElement>(screen.container, 'moment-end').value).toBe('5');
	});

	it('repopulates everything, discarding edits, when a different moment id arrives', async () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		setValue(field<HTMLInputElement>(screen.container, 'moment-name'), 'My edit');
		await screen.rerender(
			baseProps({
				moment: makeMoment({ id: 'm2', name: 'Renamed', startSeconds: 4, endSeconds: 6 })
			})
		);
		await tick();
		expect(field<HTMLInputElement>(screen.container, 'moment-name').value).toBe('Renamed');
		expect(field<HTMLInputElement>(screen.container, 'moment-start').value).toBe('4');
		expect(field<HTMLInputElement>(screen.container, 'moment-end').value).toBe('6');
	});

	it('fires onsave with the current field values', () => {
		const onsave = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onsave }) });
		findButton(screen.container, 'Save')!.click();
		expect(onsave).toHaveBeenCalledWith({
			name: 'Clip',
			description: 'notes',
			startSeconds: 1,
			endSeconds: 3
		});
	});

	it('clamps start ≥ 0 and end ≥ start + 0.001 on save', () => {
		const onsave = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onsave }) });
		setValue(field<HTMLInputElement>(screen.container, 'moment-start'), '-5');
		setValue(field<HTMLInputElement>(screen.container, 'moment-end'), '0');
		findButton(screen.container, 'Save')!.click();
		const patch = onsave.mock.calls[0]![0] as { startSeconds: number; endSeconds: number };
		expect(patch.startSeconds).toBe(0);
		expect(patch.endSeconds).toBeCloseTo(0.001);
	});

	it('coerces string/empty inputs to numbers on save', () => {
		const onsave = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onsave }) });
		setValue(field<HTMLInputElement>(screen.container, 'moment-start'), '2.5');
		setValue(field<HTMLInputElement>(screen.container, 'moment-end'), '');
		findButton(screen.container, 'Save')!.click();
		const patch = onsave.mock.calls[0]![0] as { startSeconds: number; endSeconds: number };
		expect(patch.startSeconds).toBe(2.5);
		expect(patch.endSeconds).toBeCloseTo(2.501);
	});

	it('fires ondelete with the moment id', () => {
		const ondelete = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ ondelete }) });
		findButton(screen.container, 'Delete')!.click();
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
		findButton(screen.container, 'Reprocess')!.click();
		screen.container.querySelector<HTMLButtonElement>("[title='Download']")!.click();
		screen.container.querySelector<HTMLButtonElement>("[title='Share']")!.click();
		screen.container.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click();
		expect(onexport).toHaveBeenCalledWith('m1');
		expect(ondownload).toHaveBeenCalledWith('m1');
		expect(onshare).toHaveBeenCalledWith('m1');
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it.each([['queued'], ['processing']] as Array<[Moment['exportStatus']]>)(
		'disables Reprocess while the export is %s',
		(exportStatus) => {
			const screen = render(MomentEditForm, {
				props: baseProps({ moment: makeMoment({ exportStatus }) })
			});
			expect(findButton(screen.container, 'Reprocess')!.disabled).toBe(true);
		}
	);

	it('keeps Reprocess enabled when the export is ready', () => {
		const screen = render(MomentEditForm, {
			props: baseProps({ moment: makeMoment({ exportStatus: 'ready' }) })
		});
		expect(findButton(screen.container, 'Reprocess')!.disabled).toBe(false);
	});

	it('shows a spinner on the download action when downloadPending', () => {
		const screen = render(MomentEditForm, { props: baseProps({ downloadPending: true }) });
		const download = screen.container.querySelector<HTMLButtonElement>("[title='Download']")!;
		expect(download.disabled).toBe(true);
		expect(download.querySelector('.animate-spin')).not.toBeNull();
	});

	it('fires onjumpto with the moment start/end seconds', () => {
		const onjumpto = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onjumpto }) });
		const jumpStart = screen.container.querySelector<HTMLButtonElement>(
			"[aria-label='Jump to start']"
		)!;
		const jumpEnd = screen.container.querySelector<HTMLButtonElement>(
			"[aria-label='Jump to end']"
		)!;
		expect(jumpStart.title).toContain('0:01.0');
		expect(jumpEnd.title).toContain('0:03.0');
		jumpStart.click();
		jumpEnd.click();
		expect(onjumpto.mock.calls).toEqual([[1], [3]]);
	});

	it("fires onsetToPlayhead with 'start' and 'end'", () => {
		const onsetToPlayhead = vi.fn();
		const screen = render(MomentEditForm, { props: baseProps({ onsetToPlayhead }) });
		screen.container
			.querySelector<HTMLButtonElement>("[aria-label='Set start to playhead']")!
			.click();
		screen.container
			.querySelector<HTMLButtonElement>("[aria-label='Set end to playhead']")!
			.click();
		expect(onsetToPlayhead.mock.calls).toEqual([['start'], ['end']]);
	});

	it('hides the export progress row when not exporting', () => {
		const screen = render(MomentEditForm, {
			props: baseProps({ moment: makeMoment({ exportStatus: 'ready' }) })
		});
		expect(screen.container.querySelector('.bg-warning-500')).toBeNull();
		expect(screen.container.textContent).not.toContain('Queued');
	});

	it('shows the progress %, bar width and ETA while processing', () => {
		const screen = render(MomentEditForm, {
			props: baseProps({
				moment: makeMoment({
					exportStatus: 'processing',
					exportProgress: 37.4,
					exportEtaSeconds: 12
				})
			})
		});
		const bar = screen.container.querySelector<HTMLElement>('.bg-warning-500')!;
		expect(bar.style.width).toBe('37.4%');
		expect(screen.container.textContent).toContain('37%');
		expect(screen.container.textContent).toContain('≈ 12s left');
	});

	it("shows 'Queued' with an empty bar when queued without progress", () => {
		const screen = render(MomentEditForm, {
			props: baseProps({ moment: makeMoment({ exportStatus: 'queued' }) })
		});
		expect(screen.container.textContent).toContain('Queued');
		expect(screen.container.textContent).not.toContain('≈');
		const bar = screen.container.querySelector<HTMLElement>('.bg-warning-500')!;
		expect(bar.style.width).toBe('0%');
	});

	it.each([
		[150, '100%'],
		[-20, '0%']
	])('clamps the progress bar width for progress %s to %s', (exportProgress, width) => {
		const screen = render(MomentEditForm, {
			props: baseProps({ moment: makeMoment({ exportStatus: 'processing', exportProgress }) })
		});
		const bar = screen.container.querySelector<HTMLElement>('.bg-warning-500')!;
		expect(bar.style.width).toBe(width);
	});

	it('floors the ETA readout at 1s', () => {
		const screen = render(MomentEditForm, {
			props: baseProps({
				moment: makeMoment({
					exportStatus: 'processing',
					exportProgress: 99,
					exportEtaSeconds: 0.2
				})
			})
		});
		expect(screen.container.textContent).toContain('≈ 1s left');
	});

	it('shows the stale chip when the range changed since the last export', () => {
		// A range edit makes the backend NULL exportStatus/exportedVersion and
		// bump exportVersion past its starting 1.
		const screen = render(MomentEditForm, {
			props: baseProps({
				moment: makeMoment({ exportStatus: null, exportVersion: 2, exportedVersion: null })
			})
		});
		expect(screen.container.textContent).toContain('Edited since export');
	});

	it('hides the stale chip when the moment was never exported', () => {
		const screen = render(MomentEditForm, {
			props: baseProps({
				moment: makeMoment({ exportStatus: null, exportVersion: 1, exportedVersion: null })
			})
		});
		expect(screen.container.textContent).not.toContain('Edited since export');
	});

	it('hides the stale chip when the export is current', () => {
		const screen = render(MomentEditForm, {
			props: baseProps({
				moment: makeMoment({ exportStatus: 'ready', exportVersion: 2, exportedVersion: 2 })
			})
		});
		expect(screen.container.textContent).not.toContain('Edited since export');
	});

	it('shows the clip length badge in the header', () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		const badges = Array.from(screen.container.querySelectorAll('.badge'));
		expect(badges.some((b) => b.textContent?.includes('2.00s'))).toBe(true);
	});

	it('is safe to click every action without callbacks', () => {
		const screen = render(MomentEditForm, { props: baseProps() });
		expect(() => {
			findButton(screen.container, 'Save')!.click();
			findButton(screen.container, 'Delete')!.click();
			findButton(screen.container, 'Reprocess')!.click();
			screen.container.querySelector<HTMLButtonElement>("[title='Download']")!.click();
			screen.container.querySelector<HTMLButtonElement>("[title='Share']")!.click();
			screen.container.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click();
			screen.container
				.querySelector<HTMLButtonElement>("[aria-label='Set start to playhead']")!
				.click();
			screen.container.querySelector<HTMLButtonElement>("[aria-label='Jump to end']")!.click();
		}).not.toThrow();
	});
});
