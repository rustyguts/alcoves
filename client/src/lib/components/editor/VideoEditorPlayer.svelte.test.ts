import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { LibraryFile } from '$lib/types/api';

// Force the client-only guard to no-op: with `browser` false the onMount body
// returns early and never dynamically imports the Vidstack runtime (which can't
// initialise in the headless test DOM). The player surface stays unmounted and
// the loading spinner renders, so we exercise the component shell + the runes
// that don't depend on the player element.
vi.mock('$app/environment', () => ({ browser: false }));

// Stub the playback-sources call so refreshPlaybackSources (only reached when
// browser is true) never touches the network if a future test flips the guard.
const playbackSources = vi.fn((_libraryId: string, _fileId: string) =>
	Promise.resolve({ sources: [], defaultSourceId: null })
);
vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api')>();
	return {
		...actual,
		api: {
			files: {
				playbackSources: (libraryId: string, fileId: string) => playbackSources(libraryId, fileId)
			}
		},
		apiUrl: (p: string) => p
	};
});

import VideoEditorPlayer from './VideoEditorPlayer.svelte';

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id: 'f1',
		libraryId: 'lib1',
		name: 'clip.mp4',
		mimeType: 'video/mp4',
		duration: 42,
		tags: [],
		...over
	} as LibraryFile;
}

describe('VideoEditorPlayer', () => {
	it('renders the wrapper + frame shell without crashing (no Vidstack)', async () => {
		const screen = render(VideoEditorPlayer, {
			props: { file: makeFile(), libraryId: 'lib1' }
		});
		const wrapper = screen.container.querySelector('div');
		expect(wrapper).not.toBeNull();
		// Guarded: no Vidstack runtime means the custom element is never rendered.
		expect(screen.container.querySelector('media-player')).toBeNull();
	});

	it('shows the loading spinner while the player is not ready', async () => {
		const screen = render(VideoEditorPlayer, {
			props: { file: makeFile(), libraryId: 'lib1' }
		});
		const spinner = screen.container.querySelector('svg.animate-spin');
		expect(spinner).not.toBeNull();
	});

	it('renders the active-selection overlay only when active', async () => {
		const inactive = render(VideoEditorPlayer, {
			props: { file: makeFile(), libraryId: 'lib1', active: false }
		});
		expect(inactive.container.querySelector('.border-primary-500')).toBeNull();

		const activeScreen = render(VideoEditorPlayer, {
			props: { file: makeFile(), libraryId: 'lib1', active: true }
		});
		expect(activeScreen.container.querySelector('.border-primary-500')).not.toBeNull();
	});

	it('does not emit a duration while the file has none', async () => {
		const ondurationupdate = vi.fn();
		render(VideoEditorPlayer, {
			props: { file: makeFile({ duration: 0 }), libraryId: 'lib1', ondurationupdate }
		});
		expect(ondurationupdate).not.toHaveBeenCalled();
	});

	it('emits the duration once the file gains one', async () => {
		const ondurationupdate = vi.fn();
		const screen = render(VideoEditorPlayer, {
			props: { file: makeFile({ duration: 0 }), libraryId: 'lib1', ondurationupdate }
		});
		expect(ondurationupdate).not.toHaveBeenCalled();
		await screen.rerender({
			file: makeFile({ duration: 42 }),
			libraryId: 'lib1',
			ondurationupdate
		});
		expect(ondurationupdate).toHaveBeenLastCalledWith(42);
	});

	it('hands an imperative controller to oncontroller', async () => {
		const oncontroller = vi.fn();
		render(VideoEditorPlayer, {
			props: { file: makeFile(), libraryId: 'lib1', oncontroller }
		});
		expect(oncontroller).toHaveBeenCalledTimes(1);
		const controller = oncontroller.mock.calls[0][0] as {
			seek: (s: number) => void;
			togglePlay: () => void;
		};
		expect(typeof controller.seek).toBe('function');
		expect(typeof controller.togglePlay).toBe('function');
		// With no player element mounted these are safe no-ops, not throws.
		expect(() => controller.seek(5)).not.toThrow();
		expect(() => controller.togglePlay()).not.toThrow();
	});
});
