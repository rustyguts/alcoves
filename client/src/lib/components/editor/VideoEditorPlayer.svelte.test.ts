import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryFile } from '$lib/types/api';

// Force the client-only guard to no-op: with `browser` false the onMount body
// returns early and never dynamically imports the Vidstack runtime (which can't
// initialise in the headless test DOM). The player surface stays unmounted and
// the loading spinner renders, so this file is a CONTRACT test for the shell +
// the imperative controller (the component itself is coverage-excluded; the
// real playback path is exercised by the full-stack e2e).
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
	it('renders the wrapper + frame shell without crashing (no Vidstack)', () => {
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
		await tick();
		const spinner = screen.container.querySelector('svg.animate-spin');
		expect(spinner).not.toBeNull();
	});

	it('toggles the active ring overlay with the active prop', async () => {
		const screen = render(VideoEditorPlayer, {
			props: { file: makeFile(), libraryId: 'lib1', active: false }
		});
		expect(screen.container.querySelector('.border-primary-500')).toBeNull();

		await screen.rerender({ file: makeFile(), libraryId: 'lib1', active: true });
		expect(screen.container.querySelector('.border-primary-500')).not.toBeNull();
	});

	it('does not emit a duration while the file has none', () => {
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

	it('withholds oncontroller until the player element exists, but exports the verbs', async () => {
		// oncontroller is deliberately gated on the Vidstack element being mounted
		// — a transport click during the loading spinner must never reach a null
		// element. With browser:false the player never becomes ready, so the
		// callback must NOT fire.
		const oncontroller = vi.fn();
		const screen = render(VideoEditorPlayer, {
			props: { file: makeFile(), libraryId: 'lib1', oncontroller }
		});
		await tick();
		expect(oncontroller).not.toHaveBeenCalled();

		// The bind:this exports are always available and are safe no-ops while no
		// player element is mounted.
		const c = screen.component as unknown as {
			seek: (s: number) => void;
			togglePlay: () => void;
			play: () => void;
			pause: () => void;
			setRate: (r: number) => void;
			setMuted: (m: boolean) => void;
			setVolume: (v: number) => void;
			enterFullscreen: () => void;
		};
		const methods = [
			'seek',
			'togglePlay',
			'play',
			'pause',
			'setRate',
			'setMuted',
			'setVolume',
			'enterFullscreen'
		] as const;
		for (const name of methods) {
			expect(typeof c[name], name).toBe('function');
		}
		expect(() => c.seek(5)).not.toThrow();
		expect(() => c.togglePlay()).not.toThrow();
		expect(() => c.play()).not.toThrow();
		expect(() => c.pause()).not.toThrow();
		expect(() => c.setRate(1.5)).not.toThrow();
		expect(() => c.setMuted(true)).not.toThrow();
		expect(() => c.setVolume(0.5)).not.toThrow();
		expect(() => c.enterFullscreen()).not.toThrow();
	});

	it('keeps the audio backdrop hidden until the player is ready', async () => {
		// browser:false keeps playerReady false forever, so even an audio file
		// renders the spinner branch — the backdrop only mounts once Vidstack is up.
		const screen = render(VideoEditorPlayer, {
			props: {
				file: makeFile({ name: 'song.mp3', mimeType: 'audio/mpeg' }),
				libraryId: 'lib1'
			}
		});
		await tick();
		expect(screen.container.querySelector('[data-testid="audio-backdrop"]')).toBeNull();
		expect(screen.container.querySelector('svg.animate-spin')).not.toBeNull();
	});
});
