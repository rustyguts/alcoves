import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { ComponentProps } from 'svelte';
import TimelineControls from './TimelineControls.svelte';

type Props = ComponentProps<typeof TimelineControls>;

function baseProps(over: Partial<Props> = {}): Props {
	return {
		currentTime: 10,
		duration: 100,
		zoom: 1,
		snapping: false,
		cansplit: false,
		pendingCount: 0,
		...over
	};
}

function byLabel(container: ParentNode, label: string): HTMLButtonElement {
	return container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
}

function findButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll('button')).find((b) =>
		b.textContent?.includes(label)
	);
}

describe('TimelineControls', () => {
	it('renders the timecode pair and zoom percent', async () => {
		const screen = render(TimelineControls, { props: baseProps({ zoom: 1.5 }) });
		await tick();
		expect(screen.container.textContent).toContain('0:10 / 1:40');
		expect(screen.container.textContent).toContain('150%');
	});

	it('forces hour-form timecodes once the duration reaches an hour', async () => {
		const screen = render(TimelineControls, { props: baseProps({ duration: 3600 }) });
		await tick();
		expect(screen.container.textContent).toContain('0:00:10 / 1:00:00');
	});

	it('fires the zoom in/out/fit callbacks', async () => {
		const onzoomin = vi.fn();
		const onzoomout = vi.fn();
		const onzoomfit = vi.fn();
		const screen = render(TimelineControls, {
			props: baseProps({ onzoomin, onzoomout, onzoomfit })
		});
		await tick();
		byLabel(screen.container, 'Zoom in').click();
		byLabel(screen.container, 'Zoom out').click();
		byLabel(screen.container, 'Zoom to fit').click();
		expect(onzoomin).toHaveBeenCalledTimes(1);
		expect(onzoomout).toHaveBeenCalledTimes(1);
		expect(onzoomfit).toHaveBeenCalledTimes(1);
	});

	it('does not throw when callbacks are not provided', async () => {
		const screen = render(TimelineControls, {
			props: baseProps({ cansplit: true, pendingCount: 1 })
		});
		await tick();
		expect(() => {
			byLabel(screen.container, 'Zoom in').click();
			byLabel(screen.container, 'Zoom out').click();
			byLabel(screen.container, 'Zoom to fit').click();
			byLabel(screen.container, 'Toggle snapping').click();
			byLabel(screen.container, 'Split at playhead').click();
			findButton(screen.container, 'New moment')?.click();
			findButton(screen.container, 'Save changes')?.click();
		}).not.toThrow();
	});

	it('renders the snap toggle unpressed and in the off state when snapping is off', async () => {
		const ontogglesnap = vi.fn();
		const screen = render(TimelineControls, {
			props: baseProps({ snapping: false, ontogglesnap })
		});
		await tick();
		const snap = byLabel(screen.container, 'Toggle snapping');
		expect(snap.getAttribute('aria-pressed')).toBe('false');
		expect(snap.getAttribute('data-state')).toBe('off');
		snap.click();
		expect(ontogglesnap).toHaveBeenCalledTimes(1);
	});

	it('renders the snap toggle pressed and in the on state when snapping is on', async () => {
		const screen = render(TimelineControls, { props: baseProps({ snapping: true }) });
		await tick();
		const snap = byLabel(screen.container, 'Toggle snapping');
		expect(snap.getAttribute('aria-pressed')).toBe('true');
		expect(snap.getAttribute('data-state')).toBe('on');
	});

	it('disables Split unless cansplit and never fires while disabled', async () => {
		const onsplit = vi.fn();
		const screen = render(TimelineControls, { props: baseProps({ cansplit: false, onsplit }) });
		await tick();
		const split = byLabel(screen.container, 'Split at playhead');
		expect(split.disabled).toBe(true);
		split.click();
		expect(onsplit).not.toHaveBeenCalled();
	});

	it('enables Split when cansplit and fires onsplit', async () => {
		const onsplit = vi.fn();
		const screen = render(TimelineControls, { props: baseProps({ cansplit: true, onsplit }) });
		await tick();
		const split = byLabel(screen.container, 'Split at playhead');
		expect(split.disabled).toBe(false);
		split.click();
		expect(onsplit).toHaveBeenCalledTimes(1);
	});

	it('fires oncreate from the New moment button', async () => {
		const oncreate = vi.fn();
		const screen = render(TimelineControls, { props: baseProps({ oncreate }) });
		await tick();
		findButton(screen.container, 'New moment')?.click();
		expect(oncreate).toHaveBeenCalledTimes(1);
	});

	it('disables Save changes (tonal, no count) when nothing is pending', async () => {
		const onsave = vi.fn();
		const screen = render(TimelineControls, { props: baseProps({ pendingCount: 0, onsave }) });
		await tick();
		const save = findButton(screen.container, 'Save changes');
		expect(save?.disabled).toBe(true);
		expect(save?.textContent).not.toContain('(');
		expect(save?.className).toContain('bg-secondary');
		save?.click();
		expect(onsave).not.toHaveBeenCalled();
	});

	it('shows a warning-filled Save changes with the pending count and fires onsave', async () => {
		const onsave = vi.fn();
		const screen = render(TimelineControls, { props: baseProps({ pendingCount: 2, onsave }) });
		await tick();
		const save = findButton(screen.container, 'Save changes');
		expect(save?.textContent).toContain('Save changes (2)');
		expect(save?.className).toContain('bg-warning');
		expect(save?.disabled).toBe(false);
		save?.click();
		expect(onsave).toHaveBeenCalledTimes(1);
	});

	it('shows a disabled loading state while saving', async () => {
		const onsave = vi.fn();
		const screen = render(TimelineControls, {
			props: baseProps({ pendingCount: 2, saving: true, onsave })
		});
		await tick();
		const save = findButton(screen.container, 'Save changes');
		expect(save?.disabled).toBe(true);
		expect(save?.getAttribute('aria-busy')).toBe('true');
		save?.click();
		expect(onsave).not.toHaveBeenCalled();
	});
});
