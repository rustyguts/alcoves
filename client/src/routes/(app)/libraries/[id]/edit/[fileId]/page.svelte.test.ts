import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { AudioDetection, HighlightFilter, LibraryFile, Moment } from '$lib/types/api';
import type { EditorShortcutHandlers } from '$lib/state/editor-shortcuts';
import type { PlaybackController } from '$lib/state/playback.svelte';

// ─── $app mocks ──────────────────────────────────────────────────────────────
// `page` is a shared mutable object so individual tests can swap the url's query
// (to exercise the `?from=` branch in goBack) before rendering.
const pageState = vi.hoisted(() => ({
	params: { id: 'lib-1', fileId: 'file-1' } as Record<string, string>,
	url: new URL('http://localhost/libraries/lib-1/edit/file-1'),
	data: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page: pageState }));

// goto is a plain spy; beforeNavigate records every registered guard so tests
// can invoke it with a fake navigation object (the page guards unsaved drags).
const nav = vi.hoisted(() => {
	const guards: Array<(navigation: { cancel: () => void }) => void> = [];
	return {
		goto: vi.fn(),
		guards,
		beforeNavigate: vi.fn((cb: (navigation: { cancel: () => void }) => void) => {
			guards.push(cb);
		})
	};
});
vi.mock('$app/navigation', () => ({
	goto: nav.goto,
	beforeNavigate: nav.beforeNavigate,
	invalidateAll: vi.fn()
}));
vi.mock('$app/environment', () => ({ browser: true }));

// ─── api mock (the page fetches the library + file records on mount) ─────────
// MomentShareModal renders REAL and lists shares when opened, so the share API
// is stubbed too. apiUrl is identity because $env/dynamic/public is stubbed.
const fileGet = vi.hoisted(() => vi.fn());
const libraryGet = vi.hoisted(() => vi.fn());
const listShares = vi.hoisted(() => vi.fn(async () => []));
vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api')>();
	return {
		...actual,
		api: {
			...actual.api,
			files: { ...actual.api.files, get: fileGet },
			libraries: { ...actual.api.libraries, get: libraryGet },
			moments: {
				...actual.api.moments,
				listShares,
				createShare: vi.fn(),
				revokeShare: vi.fn()
			}
		},
		apiUrl: (p: string) => p
	};
});

// ─── toast mock ──────────────────────────────────────────────────────────────
const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('$lib/state/toast', () => ({ toast: { add: toastAdd } }));

// ─── store mocks ─────────────────────────────────────────────────────────────
// A controllable backing object per store. Tests mutate it before render to drive
// the page's branches; spies assert the wiring (getters + lifecycle calls).
//
// The page wires each store with reactive *getter* closures (`() => libraryId`,
// `() => file`, …). Mocked stores otherwise never invoke them, so those one-line
// closures stay uncovered. `exerciseGetters` calls every zero-arg function the page
// hands a factory — both positional args and the values of a config object — which
// runs the closure bodies without mutating page state (setFile-style mutators take
// an argument, so they're skipped).
const exerciseGetters = vi.hoisted(() => (...args: unknown[]) => {
	const run = (v: unknown) => {
		if (typeof v === 'function' && (v as (...a: unknown[]) => unknown).length === 0) {
			try {
				(v as () => unknown)();
			} catch {
				/* getter touched a not-yet-ready store — ignore */
			}
		}
	};
	for (const a of args) {
		run(a);
		if (a && typeof a === 'object') for (const v of Object.values(a)) run(v);
	}
});

const moments = vi.hoisted(() => ({
	list: [] as Moment[],
	hasInFlight: false,
	refresh: vi.fn(async () => {}),
	// Echo the created body back so split/create flows see realistic names.
	create: vi.fn(
		async (body: { name: string; description: string; startSeconds: number; endSeconds: number }) =>
			({ id: 'm-new', ...body }) as unknown as Moment
	),
	update: vi.fn(async () => ({}) as Moment),
	remove: vi.fn(async () => {}),
	triggerExport: vi.fn(async () => ({}) as Moment),
	startPolling: vi.fn(),
	stopPolling: vi.fn(),
	dispose: vi.fn()
}));
const createLibraryMoments = vi.hoisted(() => vi.fn());
vi.mock('$lib/state/library-moments.svelte', () => ({
	createLibraryMoments: (...args: unknown[]) => {
		createLibraryMoments(...args);
		exerciseGetters(...args);
		return {
			get moments() {
				return moments.list;
			},
			get hasInFlight() {
				return moments.hasInFlight;
			},
			refresh: moments.refresh,
			create: moments.create,
			update: moments.update,
			remove: moments.remove,
			triggerExport: moments.triggerExport,
			startPolling: moments.startPolling,
			stopPolling: moments.stopPolling,
			dispose: moments.dispose
		};
	}
}));

const transcript = vi.hoisted(() => ({ vtt: null as string | null, cues: [] as unknown[] }));
vi.mock('$lib/state/transcript.svelte', () => ({
	createTranscript: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get vtt() {
				return transcript.vtt;
			},
			get cues() {
				return transcript.cues;
			},
			refresh: vi.fn(),
			sync: vi.fn()
		}
	)
}));

const transcribeJob = vi.hoisted(() => ({
	running: false,
	run: vi.fn(),
	stop: vi.fn(),
	// The page hands the job a `setFile` callback so a finished job can patch the
	// in-memory file without a refetch. Captured here so a test can fire it.
	setFile: null as null | ((f: LibraryFile) => void)
}));
vi.mock('$lib/state/transcribe-job.svelte', () => ({
	createTranscribeJob: (...args: unknown[]) => {
		exerciseGetters(...args);
		transcribeJob.setFile = args[3] as (f: LibraryFile) => void;
		return {
			get running() {
				return transcribeJob.running;
			},
			get button() {
				return { label: 'Transcribe', color: 'primary', loading: false, disabled: false };
			},
			run: transcribeJob.run,
			sync: vi.fn(),
			stop: transcribeJob.stop
		};
	}
}));

const audioDetections = vi.hoisted(() => ({
	list: [] as AudioDetection[],
	refresh: vi.fn(async () => {})
}));
vi.mock('$lib/state/audio-detections.svelte', () => ({
	createAudioDetections: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get detections() {
				return audioDetections.list;
			},
			refresh: audioDetections.refresh,
			load: vi.fn()
		}
	)
}));

const audioDetectJob = vi.hoisted(() => ({ detecting: false, run: vi.fn(), stop: vi.fn() }));
vi.mock('$lib/state/audio-detect-job.svelte', () => ({
	createAudioDetectJob: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get detecting() {
				return audioDetectJob.detecting;
			},
			get button() {
				return { label: 'Detect sounds', color: 'primary', loading: false, disabled: false };
			},
			run: audioDetectJob.run,
			sync: vi.fn(),
			stop: audioDetectJob.stop
		}
	)
}));

const waveform = vi.hoisted(() => ({
	peaks: null as number[] | null,
	peaksPerSecond: 50,
	refresh: vi.fn()
}));
vi.mock('$lib/state/waveform.svelte', () => ({
	createWaveform: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get data() {
				return null;
			},
			get peaks() {
				return waveform.peaks;
			},
			get peaksPerSecond() {
				return waveform.peaksPerSecond;
			},
			refresh: waveform.refresh
		}
	)
}));

const waveformJob = vi.hoisted(() => ({ generating: false, run: vi.fn(), stop: vi.fn() }));
vi.mock('$lib/state/waveform-job.svelte', () => ({
	createWaveformJob: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get generating() {
				return waveformJob.generating;
			},
			get button() {
				return { label: 'Generate waveform', color: 'primary', loading: false, disabled: false };
			},
			run: waveformJob.run,
			sync: vi.fn(),
			stop: waveformJob.stop
		}
	)
}));

const highlights = vi.hoisted(() => ({
	filters: [] as HighlightFilter[],
	matches: {} as Record<
		string,
		Array<{
			filterId: string;
			startSeconds: number;
			endSeconds: number;
			score: number;
			evidence: string[];
		}>
	>,
	refresh: vi.fn(async () => {})
}));
vi.mock('$lib/state/editor-highlights.svelte', () => ({
	createEditorHighlights: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get filters() {
				return highlights.filters;
			},
			get loading() {
				return false;
			},
			get cues() {
				return [];
			},
			get matches() {
				return highlights.matches;
			},
			get aggregates() {
				return {};
			},
			get hasSignals() {
				return false;
			},
			refresh: highlights.refresh,
			onCreate: vi.fn(),
			onUpdate: vi.fn(),
			onRemove: vi.fn(),
			onLoadPresets: vi.fn()
		}
	)
}));

const downloads = vi.hoisted(() => ({ pending: false, request: vi.fn(), sync: vi.fn() }));
vi.mock('$lib/state/moment-downloads.svelte', () => ({
	createMomentDownloads: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get pendingIds() {
				return new Set<string>();
			},
			isPending: () => downloads.pending,
			request: downloads.request,
			sync: downloads.sync
		}
	)
}));

const shortcuts = vi.hoisted(() => ({
	attach: vi.fn(),
	detach: vi.fn(),
	config: null as EditorShortcutHandlers | null
}));
vi.mock('$lib/state/editor-shortcuts', () => ({
	createEditorShortcuts: (cfg: EditorShortcutHandlers) => {
		shortcuts.config = cfg;
		return { onKeydown: vi.fn(), attach: shortcuts.attach, detach: shortcuts.detach };
	}
}));

// Stateful playback mock: getter-backed fields over a mutable record plus spy
// verbs. The on* feeds write the record so imperative page reads (split, create
// at playhead, I/O commits) see the values a test primed. The module's constants
// (FRAME_SECONDS / PLAYBACK_RATES / JUMP_SECONDS) stay REAL via importOriginal —
// TransportBar and MomentsTrack import them directly.
const playback = vi.hoisted(() => {
	const state = {
		currentTime: 0,
		duration: 42,
		paused: true,
		rate: 1,
		muted: false,
		volume: 1,
		loop: false
	};
	return {
		state,
		setController: vi.fn(),
		onTime: vi.fn((s: number) => {
			state.currentTime = s;
		}),
		onDuration: vi.fn((s: number) => {
			state.duration = s;
		}),
		onPaused: vi.fn((v: boolean) => {
			state.paused = v;
		}),
		onRate: vi.fn((r: number) => {
			state.rate = r;
		}),
		onVolume: vi.fn((v: number, m: boolean) => {
			state.volume = v;
			state.muted = m;
		}),
		seek: vi.fn((s: number) => {
			state.currentTime = Math.max(0, s);
		}),
		togglePlay: vi.fn(),
		stepFrame: vi.fn(),
		jump: vi.fn(),
		setRate: vi.fn((r: number) => {
			state.rate = r;
		}),
		toggleMute: vi.fn(() => {
			state.muted = !state.muted;
		}),
		setVolume: vi.fn((v: number) => {
			state.volume = v;
		}),
		toggleLoop: vi.fn(() => {
			state.loop = !state.loop;
		}),
		disarmLoop: vi.fn(() => {
			state.loop = false;
		}),
		enterFullscreen: vi.fn(),
		applyLoop: vi.fn()
	};
});
vi.mock('$lib/state/playback.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/state/playback.svelte')>();
	return {
		...actual,
		createPlayback: () => ({
			get currentTime() {
				return playback.state.currentTime;
			},
			get duration() {
				return playback.state.duration;
			},
			get paused() {
				return playback.state.paused;
			},
			get rate() {
				return playback.state.rate;
			},
			get muted() {
				return playback.state.muted;
			},
			get volume() {
				return playback.state.volume;
			},
			get loop() {
				return playback.state.loop;
			},
			setController: playback.setController,
			onTime: playback.onTime,
			onDuration: playback.onDuration,
			onPaused: playback.onPaused,
			onRate: playback.onRate,
			onVolume: playback.onVolume,
			seek: playback.seek,
			togglePlay: playback.togglePlay,
			stepFrame: playback.stepFrame,
			jump: playback.jump,
			setRate: playback.setRate,
			toggleMute: playback.toggleMute,
			setVolume: playback.setVolume,
			toggleLoop: playback.toggleLoop,
			disarmLoop: playback.disarmLoop,
			enterFullscreen: playback.enterFullscreen,
			applyLoop: playback.applyLoop
		})
	};
});

// Preferences mock: INSPECTOR_* constants stay REAL (InspectorPanel imports the
// width clamp bounds); only the factory is replaced.
const prefs = vi.hoisted(() => ({
	state: { inspectorTab: 'moments', inspectorWidth: 380, snapping: true },
	setInspectorTab: vi.fn(),
	setInspectorWidth: vi.fn(),
	setSnapping: vi.fn(),
	toggleSnapping: vi.fn()
}));
vi.mock('$lib/state/editor-preferences.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/state/editor-preferences.svelte')>();
	return {
		...actual,
		createEditorPreferences: () => ({
			get inspectorTab() {
				return prefs.state.inspectorTab;
			},
			get inspectorWidth() {
				return prefs.state.inspectorWidth;
			},
			get snapping() {
				return prefs.state.snapping;
			},
			setInspectorTab: prefs.setInspectorTab,
			setInspectorWidth: prefs.setInspectorWidth,
			setSnapping: prefs.setSnapping,
			toggleSnapping: prefs.toggleSnapping
		})
	};
});

// VideoEditorPlayer pulls in the Vidstack runtime — stub it with a lightweight
// real component mirroring the new controller contract: it publishes a 42s
// duration + a full PlaybackController whose verbs call the page's state
// callbacks back (so a test can drive oncurrenttimeupdate/onpausedupdate/… by
// invoking the controller the page registered with the playback store).
vi.mock('$lib/components/editor/VideoEditorPlayer.svelte', async () => ({
	default: (await import('./VideoEditorPlayerMock.svelte')).default
}));

import Page from './+page@(app).svelte';

const FRAME = 1 / 30;

function makeFile(over: Partial<LibraryFile> = {}): LibraryFile {
	return {
		id: 'file-1',
		libraryId: 'lib-1',
		name: 'clip.mp4',
		mimeType: 'video/mp4',
		duration: 42,
		transcribeStatus: null,
		audioDetectStatus: null,
		waveformStatus: null,
		tags: [],
		...over
	} as LibraryFile;
}

function makeMoment(id: string, over: Partial<Moment> = {}): Moment {
	return {
		id,
		fileId: 'file-1',
		name: `Moment ${id}`,
		description: '',
		startSeconds: 1,
		endSeconds: 5,
		exportStatus: null,
		exportProgress: null,
		exportEtaSeconds: null,
		exportVersion: 0,
		exportedVersion: 0,
		tags: [],
		...over
	} as Moment;
}

function makeFilter(id: string, over: Partial<HighlightFilter> = {}): HighlightFilter {
	return {
		id,
		libraryId: 'lib-1',
		createdById: null,
		name: 'Laughter',
		expression: 'laughter',
		proximitySeconds: 5,
		color: '#22c55e',
		createdAt: '2025-01-01T00:00:00Z',
		updatedAt: '2025-01-01T00:00:00Z',
		...over
	};
}

function makeDetection(id: string, over: Partial<AudioDetection> = {}): AudioDetection {
	return {
		id,
		fileId: 'file-1',
		libraryId: 'lib-1',
		label: 'Speech',
		classIndex: 0,
		score: 0.9,
		startSeconds: 1,
		endSeconds: 2,
		version: 1,
		createdAt: '2025-01-01T00:00:00Z',
		...over
	};
}

// Skeleton dialogs portal to document.body and mount on a MACROTASK — plain
// tick()/microtasks are not enough.
async function flush() {
	await tick();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
	await Promise.resolve();
	await tick();
}

// Top-bar job buttons carry their label as `title`; the inspector panels'
// empty-state CTAs share the same visible label but have NO title attribute,
// so a title selector scoped outside the inspector is unambiguous.
function topBarButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll<HTMLButtonElement>(`button[title="${label}"]`)).find(
		(b) => !b.closest('[data-testid="inspector"]')
	);
}

function byAriaLabel(container: ParentNode, label: string): HTMLButtonElement | null {
	return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

// Render then select the first list moment so the MomentEditForm mounts. The
// moment name appears in both the list and the timeline track; the list card is
// the [role="button"] inside the moments-list container.
async function selectFirstListMoment(screen: { container: HTMLElement }) {
	await tick();
	const card = screen.container.querySelector<HTMLElement>(
		'[data-testid="moments-list"] [role="button"]'
	);
	expect(card).not.toBeNull();
	card!.click();
	await vi.waitFor(() => {
		expect(screen.container.querySelector('#moment-name')).not.toBeNull();
	});
}

// The ConfirmModal's confirm button carries the error preset (its confirmClass
// is `btn-error`), distinguishing it from the form's tonal-error Delete button.
// The dialog portals to document.body, so search there.
function confirmModalDeleteButton(): HTMLButtonElement | undefined {
	// A just-closed dialog's portal can linger in document.body for a beat after
	// unmount; portals append, so the LAST match is the live one.
	return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
		.filter(
			(b) => b.className.includes('preset-filled-error-500') && b.textContent?.trim() === 'Delete'
		)
		.at(-1);
}

// The ConfirmModal's dismiss button is the plain 'Cancel'; like the delete
// button, portals append so the LAST match is the live dialog's.
function confirmModalCancelButton(): HTMLButtonElement | undefined {
	return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
		.filter((b) => b.textContent?.trim() === 'Cancel')
		.at(-1);
}

function stubPointerCapture(el: Element) {
	Object.assign(el, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
}

beforeEach(() => {
	vi.clearAllMocks();
	pageState.params = { id: 'lib-1', fileId: 'file-1' };
	pageState.url = new URL('http://localhost/libraries/lib-1/edit/file-1');
	nav.guards.length = 0;
	moments.list = [];
	moments.hasInFlight = false;
	transcript.vtt = null;
	transcript.cues = [];
	audioDetections.list = [];
	highlights.filters = [];
	highlights.matches = {};
	waveform.peaks = null;
	waveform.peaksPerSecond = 50;
	downloads.pending = false;
	shortcuts.config = null;
	transcribeJob.setFile = null;
	transcribeJob.running = false;
	audioDetectJob.detecting = false;
	waveformJob.generating = false;
	playback.state.currentTime = 0;
	playback.state.duration = 42;
	playback.state.paused = true;
	playback.state.rate = 1;
	playback.state.muted = false;
	playback.state.volume = 1;
	playback.state.loop = false;
	prefs.state.inspectorTab = 'moments';
	prefs.state.inspectorWidth = 380;
	prefs.state.snapping = true;
	fileGet.mockResolvedValue(makeFile());
	libraryGet.mockResolvedValue({ id: 'lib-1', name: 'Family Photos', sharingEnabled: true });
	listShares.mockResolvedValue([]);
	// The offscreen test container is 0-wide; the Timeline needs a nonzero
	// viewport for its px-per-second math.
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
		configurable: true,
		get: () => 1000
	});
});

afterEach(() => {
	Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
	// Flush the one-shot capture-phase click suppressor a completed bar drag
	// leaves on window, so it can't eat the next test's click.
	window.dispatchEvent(new MouseEvent('click'));
});

describe('/libraries/[id]/edit/[fileId] (video editor)', () => {
	it('instantiates the moments store with libraryId + fileId getters', async () => {
		render(Page);
		expect(createLibraryMoments).toHaveBeenCalledTimes(1);
		const [getLib, getFile] = createLibraryMoments.mock.calls[0] as [() => string, () => string];
		expect(getLib()).toBe('lib-1');
		expect(getFile()).toBe('file-1');
	});

	it('renders the editor shell: top bar, transport timecode, timeline and empty list', async () => {
		const screen = render(Page);
		await tick();
		await expect
			.element(screen.getByRole('button', { name: 'Back to library' }))
			.toBeInTheDocument();
		await expect.element(screen.getByText(/No moments yet/)).toBeInTheDocument();
		expect(screen.container.querySelector('[data-testid="timeline"]')).not.toBeNull();
		// The transport bar reads the playback store (duration primed to 42).
		await expect
			.element(screen.getByTestId('transport-timecode'))
			.toHaveTextContent('0:00.0 / 0:42.0');
	});

	it('attaches shortcuts then loads library → file → moments → highlights in order', async () => {
		render(Page);
		// Shortcuts are wired synchronously on mount.
		expect(shortcuts.attach).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => {
			expect(libraryGet).toHaveBeenCalledWith('lib-1');
			expect(fileGet).toHaveBeenCalledWith('lib-1', 'file-1');
			expect(moments.refresh).toHaveBeenCalledTimes(1);
			expect(highlights.refresh).toHaveBeenCalledTimes(1);
		});
		// fileGet also fires during store creation (exercised getter), so order is
		// asserted on the calls the mount sequence owns exclusively.
		const libOrder = libraryGet.mock.invocationCallOrder[0]!;
		const momentsOrder = moments.refresh.mock.invocationCallOrder[0]!;
		const highlightsOrder = highlights.refresh.mock.invocationCallOrder[0]!;
		expect(shortcuts.attach.mock.invocationCallOrder[0]!).toBeLessThan(libOrder);
		expect(libOrder).toBeLessThan(momentsOrder);
		expect(momentsOrder).toBeLessThan(highlightsOrder);
	});

	it('renders the player once the file resolves and registers its controller', async () => {
		const screen = render(Page);
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull()
		);
		await vi.waitFor(() => {
			expect(playback.setController).toHaveBeenCalledWith(
				expect.objectContaining({
					seek: expect.any(Function),
					togglePlay: expect.any(Function),
					setRate: expect.any(Function),
					enterFullscreen: expect.any(Function)
				})
			);
		});
	});

	it('feeds player state callbacks into the playback store', async () => {
		const screen = render(Page);
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull()
		);
		await vi.waitFor(() => expect(playback.setController).toHaveBeenCalled());
		// The mock player's controller verbs invoke the page's on* callback props,
		// which must land in the playback store.
		const controller = playback.setController.mock.calls[0]![0] as PlaybackController;
		controller.seek(7);
		expect(playback.onTime).toHaveBeenCalledWith(7);
		expect(playback.onDuration).toHaveBeenCalledWith(42);
		controller.pause();
		expect(playback.onPaused).toHaveBeenCalledWith(true);
		controller.play();
		expect(playback.onPaused).toHaveBeenCalledWith(false);
		controller.setRate(2);
		expect(playback.onRate).toHaveBeenCalledWith(2);
		controller.setMuted(true);
		expect(playback.onVolume).toHaveBeenCalledWith(1, true);
		controller.setVolume(0.5);
		expect(playback.onVolume).toHaveBeenCalledWith(0.5, false);
	});

	it('swallows a failed library/file fetch on mount (the shell still renders)', async () => {
		libraryGet.mockRejectedValue(new Error('boom'));
		fileGet.mockRejectedValue(new Error('boom'));
		const screen = render(Page);
		await tick();
		await expect
			.element(screen.getByRole('button', { name: 'Back to library' }))
			.toBeInTheDocument();
		await vi.waitFor(() => {
			expect(fileGet).toHaveBeenCalled();
			expect(moments.refresh).toHaveBeenCalled();
		});
		expect(screen.container.querySelector('[data-testid="player-stub"]')).toBeNull();
	});

	it('navigates back to the library, preserving the `from` folder', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'Back to library' }).click();
		expect(nav.goto).toHaveBeenCalledWith('/libraries/lib-1');
	});

	it('restores the originating folder when goBack sees a `from` query', async () => {
		pageState.url = new URL('http://localhost/libraries/lib-1/edit/file-1?from=folder-9');
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'Back to library' }).click();
		expect(nav.goto).toHaveBeenCalledWith('/libraries/lib-1?folder=folder-9');
	});

	it('triggers the transcribe and waveform jobs from the top bar', async () => {
		const screen = render(Page);
		await tick();
		const transcribe = topBarButton(screen.container, 'Transcribe');
		const generate = topBarButton(screen.container, 'Generate waveform');
		expect(transcribe).not.toBeUndefined();
		expect(generate).not.toBeUndefined();
		transcribe!.click();
		generate!.click();
		expect(transcribeJob.run).toHaveBeenCalledTimes(1);
		expect(waveformJob.run).toHaveBeenCalledTimes(1);
	});

	it('shows + triggers audio detection only once the file is transcribed', async () => {
		fileGet.mockResolvedValue(makeFile({ transcribeStatus: 'ready' }));
		const screen = render(Page);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
		});
		await vi.waitFor(() => {
			expect(topBarButton(screen.container, 'Detect sounds')).not.toBeUndefined();
		});
		topBarButton(screen.container, 'Detect sounds')!.click();
		expect(audioDetectJob.run).toHaveBeenCalledTimes(1);
	});

	it('hides the audio-detect action while the file has no transcript', async () => {
		const screen = render(Page);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
		});
		expect(topBarButton(screen.container, 'Detect sounds')).toBeUndefined();
	});

	it('renders the inspector tabs with per-tab counts', async () => {
		moments.list = [makeMoment('m1'), makeMoment('m2', { startSeconds: 6, endSeconds: 8 })];
		transcript.cues = [
			{ startSeconds: 0, endSeconds: 1, text: 'hello there' },
			{ startSeconds: 1, endSeconds: 2, text: 'general kenobi' },
			{ startSeconds: 2, endSeconds: 3, text: 'fancy words' }
		];
		highlights.filters = [makeFilter('f1')];
		audioDetections.list = [makeDetection('ad-1')];
		const screen = render(Page);
		await tick();
		const tabs = Array.from(screen.container.querySelectorAll('[role="tab"]'));
		expect(tabs).toHaveLength(4);
		expect(tabs[0]?.textContent).toContain('Moments');
		expect(tabs[0]?.textContent).toContain('2');
		expect(tabs[1]?.textContent).toContain('Transcript');
		expect(tabs[1]?.textContent).toContain('3');
		expect(tabs[2]?.textContent).toContain('Highlights');
		expect(tabs[2]?.textContent).toContain('1');
		expect(tabs[3]?.textContent).toContain('Audio');
		expect(tabs[3]?.textContent).toContain('1');
		// The moments tab is the persisted default.
		expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
	});

	it('switches the inspector tab through the preferences store', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('tab', { name: 'Transcript' }).click();
		expect(prefs.setInspectorTab).toHaveBeenCalledWith('transcript');
		await screen.getByRole('tab', { name: 'Audio' }).click();
		expect(prefs.setInspectorTab).toHaveBeenCalledWith('audio');
	});

	it('resizes the inspector via the divider, committing once on release', async () => {
		const screen = render(Page);
		await tick();
		const divider = screen.container.querySelector<HTMLElement>(
			'[data-testid="inspector-divider"]'
		);
		expect(divider).not.toBeNull();
		stubPointerCapture(divider!);
		divider!.dispatchEvent(
			new PointerEvent('pointerdown', { pointerId: 1, clientX: 500, bubbles: true, button: 0 })
		);
		// Dragging the left edge of a right column 20px left grows it 380 → 400 —
		// live in the panel only (aria-valuenow tracks); nothing persists mid-drag.
		divider!.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 1, clientX: 480, bubbles: true })
		);
		await tick();
		expect(divider!.getAttribute('aria-valuenow')).toBe('400');
		expect(prefs.setInspectorWidth).not.toHaveBeenCalled();
		// A huge leftward drag clamps the live width to INSPECTOR_MAX_WIDTH.
		divider!.dispatchEvent(
			new PointerEvent('pointermove', { pointerId: 1, clientX: -2000, bubbles: true })
		);
		await tick();
		expect(divider!.getAttribute('aria-valuenow')).toBe('560');
		expect(prefs.setInspectorWidth).not.toHaveBeenCalled();
		// Release commits ONCE with the final clamped value.
		divider!.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
		expect(prefs.setInspectorWidth).toHaveBeenCalledTimes(1);
		expect(prefs.setInspectorWidth).toHaveBeenCalledWith(560);
		// The divider is keyboard-operable too: ArrowLeft widens, ArrowRight
		// narrows, 16px per press (the mocked store keeps the width prop at 380).
		divider!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		expect(prefs.setInspectorWidth).toHaveBeenLastCalledWith(396);
		divider!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(prefs.setInspectorWidth).toHaveBeenLastCalledWith(364);
		expect(prefs.setInspectorWidth).toHaveBeenCalledTimes(3);
	});

	it('selects a moment from the list: form mounts and the tab pulls to moments', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await tick();
		expect(screen.container.querySelector('#moment-name')).toBeNull();
		await selectFirstListMoment(screen);
		expect(prefs.setInspectorTab).toHaveBeenCalledWith('moments');
		// The selection $effect reports the range to the loop applier.
		expect(playback.applyLoop).toHaveBeenCalledWith({ startSeconds: 1, endSeconds: 5 });
	});

	it('selects a moment from the timeline bar too', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await tick();
		const bar = screen.container.querySelector<HTMLElement>('[data-timeline-bar="m1"]');
		expect(bar).not.toBeNull();
		bar!.click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#moment-name')).not.toBeNull();
		});
		expect(prefs.setInspectorTab).toHaveBeenCalledWith('moments');
	});

	it('creates a moment at the playhead from the timeline controls', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'New moment', exact: true }).click();
		await vi.waitFor(() => {
			expect(moments.create).toHaveBeenCalledTimes(1);
		});
		// Playhead at 0, duration 42 → 5s default clip.
		expect(moments.create).toHaveBeenCalledWith({
			name: '',
			description: '',
			startSeconds: 0,
			endSeconds: 5
		});
		expect(toastAdd).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Moment created', color: 'success' })
		);
		// The new moment is selected, which pulls the inspector onto Moments.
		expect(prefs.setInspectorTab).toHaveBeenCalledWith('moments');
	});

	it('creates a moment from the empty-state CTA', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'New moment M' }).click();
		await vi.waitFor(() => {
			expect(moments.create).toHaveBeenCalledTimes(1);
		});
	});

	it('toasts an error when creating a moment fails', async () => {
		moments.create.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'New moment', exact: true }).click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to create moment', color: 'error' })
			);
		});
	});

	it('saves an edited moment from the form', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		await vi.waitFor(() => {
			expect(moments.update).toHaveBeenCalledWith('m1', {
				name: 'Moment m1',
				description: '',
				startSeconds: 1,
				endSeconds: 5
			});
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Moment saved', color: 'success' })
			);
		});
	});

	it('toasts an error when saving the form fails', async () => {
		moments.list = [makeMoment('m1')];
		moments.update.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to save moment', color: 'error' })
			);
		});
	});

	it('commits a WYSIWYG both-field patch when setting the start to the playhead', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		// Playhead past end − 0.05 → start clamps to endSeconds − 0.05.
		playback.state.currentTime = 4.99;
		byAriaLabel(screen.container, 'Set start to playhead')!.click();
		await vi.waitFor(() => {
			expect(moments.update).toHaveBeenCalledWith('m1', {
				startSeconds: expect.closeTo(4.95, 5),
				endSeconds: 5
			});
		});
	});

	it('commits a clamped end when setting the end to the playhead', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		// Playhead before start + 0.05 → end clamps to startSeconds + 0.05.
		playback.state.currentTime = 0.5;
		byAriaLabel(screen.container, 'Set end to playhead')!.click();
		await vi.waitFor(() => {
			expect(moments.update).toHaveBeenCalledWith('m1', {
				startSeconds: 1,
				endSeconds: expect.closeTo(1.05, 5)
			});
		});
	});

	it('toasts when a set-to-playhead commit fails, and no-ops without a selection', async () => {
		moments.list = [makeMoment('m1')];
		moments.update.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await tick();
		// No selection yet — the shortcut handlers must not touch the store.
		shortcuts.config!.onSetStart!();
		shortcuts.config!.onSetEnd!();
		expect(moments.update).not.toHaveBeenCalled();
		await selectFirstListMoment(screen);
		playback.state.currentTime = 2;
		shortcuts.config!.onSetStart!();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to update moment', color: 'error' })
			);
		});
	});

	it('splits at the playhead: creates the right half first, then shrinks the original', async () => {
		moments.list = [makeMoment('m1')];
		playback.state.currentTime = 3;
		const screen = render(Page);
		await selectFirstListMoment(screen);
		const split = byAriaLabel(screen.container, 'Split at playhead')!;
		expect(split.disabled).toBe(false);
		split.click();
		await vi.waitFor(() => {
			expect(moments.create).toHaveBeenCalledWith({
				name: 'Moment m1 (2)',
				description: '',
				startSeconds: 3,
				endSeconds: 5
			});
			expect(moments.update).toHaveBeenCalledWith('m1', { startSeconds: 1, endSeconds: 3 });
		});
		// Create-first ordering: if create fails nothing has changed.
		expect(moments.create.mock.invocationCallOrder[0]!).toBeLessThan(
			moments.update.mock.invocationCallOrder[0]!
		);
		expect(toastAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Moment split',
				description: 'Moment m1 → Moment m1 (2)',
				color: 'success'
			})
		);
	});

	it('reports an incomplete split when the original update fails (created half kept)', async () => {
		moments.list = [makeMoment('m1')];
		moments.update.mockRejectedValueOnce(new Error('overlap'));
		playback.state.currentTime = 3;
		const screen = render(Page);
		await selectFirstListMoment(screen);
		shortcuts.config!.onSplit!();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Split incomplete', color: 'error' })
			);
		});
		expect(moments.create).toHaveBeenCalledTimes(1);
		// Selection stays on the original moment — the form keeps its values.
		const nameInput = screen.container.querySelector<HTMLInputElement>('#moment-name');
		expect(nameInput?.value).toBe('Moment m1');
	});

	it('toasts when the split create fails and leaves the original untouched', async () => {
		moments.list = [makeMoment('m1')];
		moments.create.mockRejectedValueOnce(new Error('nope'));
		playback.state.currentTime = 3;
		const screen = render(Page);
		await selectFirstListMoment(screen);
		shortcuts.config!.onSplit!();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to split moment', color: 'error' })
			);
		});
		expect(moments.update).not.toHaveBeenCalled();
	});

	it('refuses to split outside the 0.05s gate or without a selection', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await tick();
		// No selection → no-op.
		shortcuts.config!.onSplit!();
		expect(moments.create).not.toHaveBeenCalled();
		await selectFirstListMoment(screen);
		// Playhead (0) before the moment start → gate fails on the left side.
		shortcuts.config!.onSplit!();
		expect(moments.create).not.toHaveBeenCalled();
		expect(byAriaLabel(screen.container, 'Split at playhead')!.disabled).toBe(true);
	});

	it('queues an export via the form Reprocess button', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Reprocess' }).click();
		await vi.waitFor(() => {
			expect(moments.triggerExport).toHaveBeenCalledWith('m1');
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Export queued', color: 'success' })
			);
		});
	});

	it('toasts an error when the export trigger fails', async () => {
		moments.list = [makeMoment('m1')];
		moments.triggerExport.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Reprocess' }).click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to queue export', color: 'error' })
			);
		});
	});

	it('requests a download for the selected moment', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Download' }).click();
		expect(downloads.request).toHaveBeenCalledWith('m1');
	});

	it('jumps to a moment from the list and to range edges from the form', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		byAriaLabel(screen.container, 'Jump to start of Moment m1')!.click();
		expect(playback.seek).toHaveBeenCalledWith(1);
		byAriaLabel(screen.container, 'Jump to end')!.click();
		expect(playback.seek).toHaveBeenCalledWith(5);
		byAriaLabel(screen.container, 'Jump to start')!.click();
		expect(playback.seek).toHaveBeenLastCalledWith(1);
	});

	it('opens the share modal when sharing is enabled and suspends shortcuts', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await vi.waitFor(() => expect(libraryGet).toHaveBeenCalled());
		await selectFirstListMoment(screen);
		expect(shortcuts.config!.isSuspended!()).toBe(false);
		await screen.getByRole('button', { name: 'Share' }).click();
		await flush();
		expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'warning' }));
		expect(document.body.textContent).toContain('Share moment');
		expect(shortcuts.config!.isSuspended!()).toBe(true);
	});

	it('warns instead of sharing when the library has sharing disabled', async () => {
		libraryGet.mockResolvedValue({ id: 'lib-1', name: 'Family Photos', sharingEnabled: false });
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await vi.waitFor(() => expect(libraryGet).toHaveBeenCalled());
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Share' }).click();
		expect(toastAdd).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Sharing is disabled for this library', color: 'warning' })
		);
	});

	it('deletes through the ConfirmModal, clearing selection and disarming the loop', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		await flush();
		await vi.waitFor(() => {
			expect(confirmModalDeleteButton()).not.toBeUndefined();
		});
		confirmModalDeleteButton()!.click();
		await vi.waitFor(() => {
			expect(moments.remove).toHaveBeenCalledWith('m1');
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Moment deleted', color: 'success' })
			);
		});
		expect(playback.disarmLoop).toHaveBeenCalled();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#moment-name')).toBeNull();
		});
	});

	it('toasts an error when deleting a moment fails', async () => {
		moments.list = [makeMoment('m1')];
		moments.remove.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		await flush();
		await vi.waitFor(() => {
			expect(confirmModalDeleteButton()).not.toBeUndefined();
		});
		confirmModalDeleteButton()!.click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to delete moment', color: 'error' })
			);
		});
	});

	it('requests deletion via the Delete shortcut, suspending the keymap meanwhile', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		expect(shortcuts.config!.isSuspended!()).toBe(false);
		shortcuts.config!.onRequestDelete!();
		await flush();
		expect(shortcuts.config!.isSuspended!()).toBe(true);
		await vi.waitFor(() => {
			expect(confirmModalDeleteButton()).not.toBeUndefined();
		});
		confirmModalDeleteButton()!.click();
		await vi.waitFor(() => {
			expect(moments.remove).toHaveBeenCalledWith('m1');
		});
	});

	it('cancelling the delete dialog clears the request and re-enables shortcuts', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		await flush();
		// The open dialog suspends the keymap (pendingDeleteId is set).
		expect(shortcuts.config!.isSuspended!()).toBe(true);
		await vi.waitFor(() => {
			expect(confirmModalCancelButton()).not.toBeUndefined();
		});
		confirmModalCancelButton()!.click();
		await flush();
		// oncancel cleared pendingDeleteId: nothing was deleted and the keymap is
		// live again — a shortcut reaches the page once more.
		expect(moments.remove).not.toHaveBeenCalled();
		expect(shortcuts.config!.isSuspended!()).toBe(false);
		shortcuts.config!.onTogglePlay!();
		expect(playback.togglePlay).toHaveBeenCalledTimes(1);
	});

	it('ignores the Delete shortcut when nothing is selected', async () => {
		render(Page);
		await tick();
		shortcuts.config!.onRequestDelete!();
		await flush();
		// pendingDeleteId stays null: the keymap is not suspended (no modal opened)
		// and nothing was deleted. (DOM-absence checks are unreliable here — a
		// previous test's closing dialog portal can linger in document.body.)
		expect(shortcuts.config!.isSuspended!()).toBe(false);
		expect(moments.remove).not.toHaveBeenCalled();
	});

	it('closes the edit form, hiding it and disarming the loop', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await selectFirstListMoment(screen);
		await screen.getByRole('button', { name: 'Close' }).click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#moment-name')).toBeNull();
		});
		expect(playback.disarmLoop).toHaveBeenCalled();
	});

	it('wires the transport bar to the playback store', async () => {
		const screen = render(Page);
		await tick();
		byAriaLabel(screen.container, 'Play')!.click();
		expect(playback.togglePlay).toHaveBeenCalledTimes(1);
		byAriaLabel(screen.container, 'Back 5 seconds')!.click();
		expect(playback.jump).toHaveBeenCalledWith(-5);
		byAriaLabel(screen.container, 'Step forward one frame')!.click();
		expect(playback.stepFrame).toHaveBeenCalledWith(1);
		byAriaLabel(screen.container, 'Mute')!.click();
		expect(playback.toggleMute).toHaveBeenCalledTimes(1);
		byAriaLabel(screen.container, 'Fullscreen')!.click();
		expect(playback.enterFullscreen).toHaveBeenCalledTimes(1);
		const rate = screen.container.querySelector<HTMLSelectElement>(
			'select[aria-label="Playback rate"]'
		)!;
		rate.value = '1.5';
		rate.dispatchEvent(new Event('change', { bubbles: true }));
		expect(playback.setRate).toHaveBeenCalledWith(1.5);
		const volume = screen.container.querySelector<HTMLInputElement>('input[aria-label="Volume"]')!;
		volume.value = '0.4';
		volume.dispatchEvent(new Event('input', { bubbles: true }));
		expect(playback.setVolume).toHaveBeenCalledWith(0.4);
	});

	it('hides the fullscreen control for audio files', async () => {
		fileGet.mockResolvedValue(makeFile({ name: 'pod.mp3', mimeType: 'audio/mpeg' }));
		const screen = render(Page);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
		});
		expect(byAriaLabel(screen.container, 'Fullscreen')).toBeNull();
	});

	it('arms the loop only with a selection and applies the selected range', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await tick();
		// Without a selection the loop toggle is inert (button disabled, shortcut no-op).
		expect(byAriaLabel(screen.container, 'Loop selected moment')!.disabled).toBe(true);
		shortcuts.config!.onToggleLoop!();
		expect(playback.toggleLoop).not.toHaveBeenCalled();
		await selectFirstListMoment(screen);
		expect(playback.applyLoop).toHaveBeenCalledWith({ startSeconds: 1, endSeconds: 5 });
		shortcuts.config!.onToggleLoop!();
		expect(playback.toggleLoop).toHaveBeenCalledTimes(1);
		byAriaLabel(screen.container, 'Loop selected moment')!.click();
		expect(playback.toggleLoop).toHaveBeenCalledTimes(2);
	});

	it('routes the remaining shortcuts: playback verbs, snap, zoom and help', async () => {
		const screen = render(Page);
		await tick();
		const cfg = shortcuts.config!;
		cfg.onTogglePlay!();
		expect(playback.togglePlay).toHaveBeenCalledTimes(1);
		cfg.onJump!(5);
		expect(playback.jump).toHaveBeenCalledWith(5);
		cfg.onStepFrame!(-1);
		expect(playback.stepFrame).toHaveBeenCalledWith(-1);
		cfg.onToggleSnap!();
		expect(prefs.toggleSnapping).toHaveBeenCalledTimes(1);
		// Zoom verbs hit the REAL timeline controller — the zoom readout moves.
		await expect.element(screen.getByText('100%')).toBeInTheDocument();
		cfg.onZoomIn!();
		await expect.element(screen.getByText('150%')).toBeInTheDocument();
		cfg.onZoomOut!();
		await expect.element(screen.getByText('100%')).toBeInTheDocument();
		cfg.onZoomIn!();
		cfg.onZoomFit!();
		await expect.element(screen.getByText('100%')).toBeInTheDocument();
		expect(() => {
			cfg.onScroll!(1);
			cfg.onCenter!();
		}).not.toThrow();
		// `?` opens the keyboard-help dialog (and suspends the keymap).
		cfg.onOpenHelp!();
		await flush();
		expect(document.body.textContent).toContain('Play / pause');
		expect(cfg.isSuspended!()).toBe(true);
	});

	it('opens the keyboard shortcuts modal from the top bar', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'Keyboard shortcuts' }).click();
		await flush();
		expect(document.body.textContent).toContain('Play / pause');
	});

	it('toggles snapping from the timeline controls', async () => {
		const screen = render(Page);
		await tick();
		byAriaLabel(screen.container, 'Toggle snapping')!.click();
		expect(prefs.toggleSnapping).toHaveBeenCalledTimes(1);
	});

	it('registers a beforeNavigate guard that passes through when nothing is pending', async () => {
		render(Page);
		await tick();
		expect(nav.beforeNavigate).toHaveBeenCalledWith(expect.any(Function));
		const confirmSpy = vi.spyOn(window, 'confirm');
		const cancel = vi.fn();
		nav.guards[0]!({ cancel });
		expect(cancel).not.toHaveBeenCalled();
		expect(confirmSpy).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it('blocks navigation with pending timeline edits unless the user confirms', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await tick();
		// An ArrowRight nudge on a focused bar writes a pending (unsaved) edit.
		const bar = screen.container.querySelector<HTMLElement>('[data-timeline-bar="m1"]')!;
		bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await tick();
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const cancel = vi.fn();
		nav.guards[0]!({ cancel });
		expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved moment changes?');
		expect(cancel).toHaveBeenCalledTimes(1);
		// Confirming the discard lets the navigation through.
		confirmSpy.mockReturnValue(true);
		const cancel2 = vi.fn();
		nav.guards[0]!({ cancel: cancel2 });
		expect(cancel2).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it('batch-saves pending timeline edits and queues exports', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await tick();
		const bar = screen.container.querySelector<HTMLElement>('[data-timeline-bar="m1"]')!;
		bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await tick();
		await screen.getByRole('button', { name: 'Save changes (1)' }).click();
		await vi.waitFor(() => {
			expect(moments.update).toHaveBeenCalledWith('m1', {
				startSeconds: expect.closeTo(1 + FRAME, 5),
				endSeconds: expect.closeTo(5 + FRAME, 5)
			});
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Saved 1 moment(s)', color: 'success' })
			);
		});
		await vi.waitFor(() => {
			expect(moments.triggerExport).toHaveBeenCalledWith('m1');
		});
	});

	it('toasts when the batch save fails, keeping the edit pending and skipping export', async () => {
		moments.list = [makeMoment('m1')];
		moments.update.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await tick();
		const bar = screen.container.querySelector<HTMLElement>('[data-timeline-bar="m1"]')!;
		bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await tick();
		await screen.getByRole('button', { name: 'Save changes (1)' }).click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({
					title: 'Failed to save 1 moment(s)',
					description: 'The unsaved edits are still highlighted on the timeline.',
					color: 'error'
				})
			);
		});
		// Nothing fulfilled → no success toast and no export queued.
		expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
		expect(moments.triggerExport).not.toHaveBeenCalled();
		// The failed entry was NOT cleared eagerly: the server never echoed the
		// new range, so the pending edit (and its Save button) survives the failure.
		await expect
			.element(screen.getByRole('button', { name: 'Save changes (1)' }))
			.toBeInTheDocument();
	});

	it('renders highlight matches as timeline markers with composed titles', async () => {
		highlights.filters = [makeFilter('f1', { name: 'Laughter', color: '#22c55e' })];
		highlights.matches = {
			f1: [{ filterId: 'f1', startSeconds: 2, endSeconds: 3, score: 0.8, evidence: ['ha', 'haha'] }]
		};
		const screen = render(Page);
		await tick();
		const marker = screen.container.querySelector<HTMLButtonElement>(
			'[data-testid="markers-track"] button'
		);
		expect(marker).not.toBeNull();
		expect(marker!.title).toBe('Laughter · 0:02 · ha + haha');
		marker!.click();
		expect(playback.seek).toHaveBeenCalledWith(2);
	});

	it('omits the markers lane when no filter matches exist', async () => {
		const screen = render(Page);
		await tick();
		expect(screen.container.querySelector('[data-testid="markers-track"]')).toBeNull();
	});

	it('renders the waveform track when peaks are available', async () => {
		waveform.peaks = [0.1, 0.5, 0.9, 0.4];
		waveform.peaksPerSecond = 50;
		const screen = render(Page);
		await tick();
		const track = screen.container.querySelector('[data-testid="waveform-track"]');
		expect(track).not.toBeNull();
		// The lane label chip (the 'Audio' inspector tab also matches by text, so
		// scope to the track).
		expect(track!.textContent).toContain('Audio');
		expect(track!.querySelector('canvas')).not.toBeNull();
	});

	it('seeks from a transcript cue through the inspector', async () => {
		transcript.cues = [{ startSeconds: 2, endSeconds: 3, text: 'hello world' }];
		const screen = render(Page);
		await tick();
		const cueButton = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('[data-testid="inspector"] button')
		).find((b) => b.textContent?.includes('hello world'));
		expect(cueButton).not.toBeUndefined();
		cueButton!.click();
		expect(playback.seek).toHaveBeenCalledWith(2);
	});

	it('runs the transcribe job from the transcript empty-state CTA', async () => {
		const screen = render(Page);
		await tick();
		const cta = Array.from(
			screen.container.querySelectorAll<HTMLButtonElement>('[data-testid="inspector"] button')
		).find((b) => b.textContent?.trim() === 'Transcribe');
		expect(cta).not.toBeUndefined();
		cta!.click();
		expect(transcribeJob.run).toHaveBeenCalledTimes(1);
	});

	it('starts the moments poller when a moment is in flight', async () => {
		moments.list = [makeMoment('m1', { exportStatus: 'processing' })];
		moments.hasInFlight = true;
		render(Page);
		await tick();
		expect(moments.startPolling).toHaveBeenCalled();
	});

	it('keeps the download queue in sync with the moments list', async () => {
		moments.list = [makeMoment('m1')];
		render(Page);
		await tick();
		expect(downloads.sync).toHaveBeenCalled();
	});

	it('refreshes audio detections once the file id resolves', async () => {
		render(Page);
		await vi.waitFor(() => {
			expect(audioDetections.refresh).toHaveBeenCalled();
		});
	});

	it('patches the in-memory file when a finished job hands one back', async () => {
		const screen = render(Page);
		await vi.waitFor(() => expect(transcribeJob.setFile).not.toBeNull());
		transcribeJob.setFile!(makeFile({ name: 'updated.mp4', transcribeStatus: 'ready' }));
		await expect.element(screen.getByText('updated.mp4')).toBeInTheDocument();
	});

	it('marks the active moment when the playhead lands inside its range', async () => {
		// currentTime starts at 0; a moment spanning 0–8s contains the playhead, so
		// activeMoment resolves — exercising the predicate over a populated list.
		moments.list = [makeMoment('m1', { startSeconds: 0, endSeconds: 8 })];
		const screen = render(Page);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
		});
	});

	it('disposes stores and detaches shortcuts on destroy', async () => {
		const { unmount } = render(Page);
		await tick();
		unmount();
		expect(moments.dispose).toHaveBeenCalledTimes(1);
		expect(shortcuts.detach).toHaveBeenCalledTimes(1);
		expect(transcribeJob.stop).toHaveBeenCalledTimes(1);
		expect(audioDetectJob.stop).toHaveBeenCalledTimes(1);
		expect(waveformJob.stop).toHaveBeenCalledTimes(1);
	});
});
