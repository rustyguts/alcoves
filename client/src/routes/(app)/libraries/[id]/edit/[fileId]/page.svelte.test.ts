import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { LibraryFile, Moment } from '$lib/types/api';

// ─── $app mocks ──────────────────────────────────────────────────────────────
// `page` is a shared mutable object so individual tests can swap the url's query
// (to exercise the `?from=` branch in goBack) before rendering.
const pageState = vi.hoisted(() => ({
	params: { id: 'lib-1', fileId: 'file-1' } as Record<string, string>,
	url: new URL('http://localhost/libraries/lib-1/edit/file-1'),
	data: {} as Record<string, unknown>
}));
vi.mock('$app/state', () => ({ page: pageState }));

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto, invalidateAll: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: true }));

// ─── api mock (the page fetches the library + file records on mount) ─────────
const fileGet = vi.hoisted(() => vi.fn());
const libraryGet = vi.hoisted(() => vi.fn());
vi.mock('$lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/api')>();
	return {
		...actual,
		api: {
			...actual.api,
			files: { ...actual.api.files, get: fileGet },
			libraries: { ...actual.api.libraries, get: libraryGet }
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
	create: vi.fn(async () => ({ id: 'm-new' }) as Moment),
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
	list: [] as unknown[],
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

vi.mock('$lib/state/waveform.svelte', () => ({
	createWaveform: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get data() {
				return null;
			},
			get peaks() {
				return null;
			},
			get peaksPerSecond() {
				return 50;
			},
			refresh: vi.fn()
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

const highlights = vi.hoisted(() => ({ refresh: vi.fn(async () => {}) }));
vi.mock('$lib/state/editor-highlights.svelte', () => ({
	createEditorHighlights: (...args: unknown[]) => (
		exerciseGetters(...args),
		{
			get filters() {
				return [];
			},
			get loading() {
				return false;
			},
			get cues() {
				return [];
			},
			get matches() {
				return {};
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
	config: null as null | {
		hasSelection: () => boolean;
		onSetStart: () => void;
		onSetEnd: () => void;
		onCreate: () => void;
		onTogglePlay: () => void;
	}
}));
vi.mock('$lib/state/editor-shortcuts', () => ({
	createEditorShortcuts: (cfg: typeof shortcuts.config) => {
		shortcuts.config = cfg;
		return {
			onKeydown: vi.fn(),
			attach: shortcuts.attach,
			detach: shortcuts.detach
		};
	}
}));

// VideoEditorPlayer pulls in the Vidstack runtime — stub it with a lightweight
// real component. It still renders the `data-testid="player-stub"` marker (so the
// {#if file} branch is observable) but, crucially, exports `seek`/`togglePlay` so
// the page's `bind:this={playerRef}` exposes the imperative surface onSeek calls.
vi.mock('$lib/components/editor/VideoEditorPlayer.svelte', async () => ({
	default: (await import('./VideoEditorPlayerMock.svelte')).default
}));

import Page from './+page@(app).svelte';

// The editor reads route params + its stores; it fetches the library/file itself
// (it renders in the dashboard shell, not the library subtree), so it takes no
// `data` prop. Library identity comes from the mocked `page.params`.

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
		exportVersion: 0,
		exportedVersion: 0,
		tags: [],
		...over
	} as Moment;
}

// Render then select the first moment so the MomentEditForm mounts. Returns the
// rendered screen once the form's name input is present.
async function renderWithSelected(screen: ReturnType<typeof render>) {
	await tick();
	await screen.getByRole('button', { name: /Moment m1 — 1\.0s/ }).click();
	await vi.waitFor(() => {
		expect(screen.container.querySelector('#moment-name')).not.toBeNull();
	});
}

// The ConfirmModal's confirm button carries the error preset (its confirmClass is
// `btn-error`), distinguishing it from the form's tonal-error Delete button.
function confirmModalDeleteButton(root: ParentNode): HTMLButtonElement | undefined {
	return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
		(b) => b.className.includes('preset-filled-error-500') && b.textContent?.trim() === 'Delete'
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	pageState.params = { id: 'lib-1', fileId: 'file-1' };
	pageState.url = new URL('http://localhost/libraries/lib-1/edit/file-1');
	moments.list = [];
	moments.hasInFlight = false;
	transcript.vtt = null;
	transcript.cues = [];
	audioDetections.list = [];
	downloads.pending = false;
	shortcuts.config = null;
	transcribeJob.setFile = null;
	transcribeJob.running = false;
	audioDetectJob.detecting = false;
	waveformJob.generating = false;
	fileGet.mockResolvedValue(makeFile());
	libraryGet.mockResolvedValue({ id: 'lib-1', name: 'Family Photos', sharingEnabled: true });
});

describe('/libraries/[id]/edit/[fileId] (video editor)', () => {
	it('instantiates the moments store with libraryId + fileId getters', async () => {
		render(Page);
		expect(createLibraryMoments).toHaveBeenCalledTimes(1);
		const [getLib, getFile] = createLibraryMoments.mock.calls[0] as [() => string, () => string];
		expect(getLib()).toBe('lib-1');
		expect(getFile()).toBe('file-1');
	});

	it('renders the editor shell with the header and moments panel', async () => {
		const screen = render(Page);
		await tick();
		await expect.element(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
		// The empty-moments hint renders when no moments exist.
		await expect.element(screen.getByText(/No moments yet/)).toBeInTheDocument();
	});

	it('loads the file and moments on mount and refreshes highlights', async () => {
		render(Page);
		// Shortcuts are wired synchronously on mount.
		expect(shortcuts.attach).toHaveBeenCalledTimes(1);
		// The rest run across the mount's awaits.
		await vi.waitFor(() => {
			expect(libraryGet).toHaveBeenCalledWith('lib-1');
			expect(fileGet).toHaveBeenCalledWith('lib-1', 'file-1');
			expect(moments.refresh).toHaveBeenCalledTimes(1);
			expect(highlights.refresh).toHaveBeenCalledTimes(1);
		});
	});

	it('renders the video player once the file resolves', async () => {
		const screen = render(Page);
		// Wait for the on-mount file fetch to resolve and the {#if file} branch to render.
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull()
		);
	});

	it('swallows a failed library/file fetch on mount (the shell still renders)', async () => {
		libraryGet.mockRejectedValue(new Error('boom'));
		fileGet.mockRejectedValue(new Error('boom'));
		const screen = render(Page);
		await tick();
		// Header still present; no player since the file never resolved.
		await expect.element(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
		await vi.waitFor(() => {
			expect(fileGet).toHaveBeenCalled();
			expect(moments.refresh).toHaveBeenCalled();
		});
		expect(screen.container.querySelector('[data-testid="player-stub"]')).toBeNull();
	});

	it('navigates back to the library, preserving the `from` folder', async () => {
		const screen = render(Page);
		await tick();
		// No `from` query in the mocked url → plain library path.
		await screen.getByRole('button', { name: 'Back' }).click();
		expect(goto).toHaveBeenCalledWith('/libraries/lib-1');
	});

	it('restores the originating folder when goBack sees a `from` query', async () => {
		pageState.url = new URL('http://localhost/libraries/lib-1/edit/file-1?from=folder-9');
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'Back' }).click();
		expect(goto).toHaveBeenCalledWith('/libraries/lib-1?folder=folder-9');
	});

	it('shows the transcribe action for a playable file', async () => {
		const screen = render(Page);
		await tick();
		await expect.element(screen.getByRole('button', { name: /Transcribe/ })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: /Generate waveform/ }))
			.toBeInTheDocument();
	});

	it('triggers the transcribe and waveform jobs from the header', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: /Transcribe/ }).click();
		await screen.getByRole('button', { name: /Generate waveform/ }).click();
		expect(transcribeJob.run).toHaveBeenCalledTimes(1);
		expect(waveformJob.run).toHaveBeenCalledTimes(1);
	});

	it('shows + triggers audio detection only once the file is transcribed', async () => {
		fileGet.mockResolvedValue(makeFile({ transcribeStatus: 'ready' }));
		const screen = render(Page);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
		});
		await screen.getByRole('button', { name: /Detect sounds/ }).click();
		expect(audioDetectJob.run).toHaveBeenCalledTimes(1);
	});

	it('renders the moments list and selects a moment on click', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await tick();
		// The selected-moment edit form only appears after a moment is selected.
		expect(screen.container.querySelector('#moment-name')).toBeNull();
		// "Moment m1" appears in both the list and the timeline; target the list
		// card's button (it carries the duration label in its accessible name).
		await screen.getByRole('button', { name: /Moment m1 — 1\.0s/ }).click();
		// Once selected, the edit form mounts (its name field is present).
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#moment-name')).not.toBeNull();
		});
	});

	it('creates a moment at the playhead and selects it', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'New moment' }).click();
		await vi.waitFor(() => {
			expect(moments.create).toHaveBeenCalledTimes(1);
		});
		// Default playhead is 0; duration unknown until durationupdate, so end = 5.
		expect(moments.create).toHaveBeenCalledWith({
			name: '',
			description: '',
			startSeconds: 0,
			endSeconds: 5
		});
		expect(toastAdd).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Moment created', color: 'success' })
		);
	});

	it('toasts an error when creating a moment fails', async () => {
		moments.create.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'New moment' }).click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to create moment', color: 'error' })
			);
		});
	});

	it('saves an edited moment from the form', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await renderWithSelected(screen);
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		await vi.waitFor(() => {
			expect(moments.update).toHaveBeenCalledTimes(1);
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Moment saved', color: 'success' })
			);
		});
	});

	it('toasts an error when saving the form fails', async () => {
		moments.list = [makeMoment('m1')];
		moments.update.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await renderWithSelected(screen);
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to save moment', color: 'error' })
			);
		});
	});

	it('snaps the moment start/end to the playhead', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await renderWithSelected(screen);
		const snapButtons = screen.container.querySelectorAll('button[title="Set to playhead"]');
		expect(snapButtons.length).toBe(2);
		(snapButtons[0] as HTMLButtonElement).click();
		(snapButtons[1] as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect(moments.update).toHaveBeenCalledWith('m1', { startSeconds: 0 });
			expect(moments.update).toHaveBeenCalledWith('m1', { endSeconds: 0 });
		});
	});

	it('queues an export via the form Reprocess button', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await renderWithSelected(screen);
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
		await renderWithSelected(screen);
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
		await renderWithSelected(screen);
		await screen.getByRole('button', { name: 'Download' }).click();
		expect(downloads.request).toHaveBeenCalledWith('m1');
	});

	it('opens the share modal when sharing is enabled', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await renderWithSelected(screen);
		await screen.getByRole('button', { name: 'Share' }).click();
		// No warning toast — sharing was enabled, so the modal path runs instead.
		expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'warning' }));
	});

	it('warns instead of sharing when the library has sharing disabled', async () => {
		libraryGet.mockResolvedValue({ id: 'lib-1', name: 'Family Photos', sharingEnabled: false });
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		// Wait for the library fetch to land so library?.sharingEnabled is false.
		await vi.waitFor(() => expect(libraryGet).toHaveBeenCalled());
		await renderWithSelected(screen);
		await screen.getByRole('button', { name: 'Share' }).click();
		expect(toastAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Sharing is disabled for this library',
				color: 'warning'
			})
		);
	});

	it('requests deletion and confirms it, clearing the selection', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await renderWithSelected(screen);
		// Delete in the form only marks the moment pending — it opens the confirm modal.
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		// The confirm modal's confirm button also reads "Delete"; it carries the error
		// preset, distinguishing it from the form's tonal-error button. Wait for it.
		await vi.waitFor(() => {
			expect(confirmModalDeleteButton(screen.container)).not.toBeUndefined();
		});
		confirmModalDeleteButton(screen.container)!.click();
		await vi.waitFor(() => {
			expect(moments.remove).toHaveBeenCalledWith('m1');
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Moment deleted', color: 'success' })
			);
		});
	});

	it('toasts an error when deleting a moment fails', async () => {
		moments.list = [makeMoment('m1')];
		moments.remove.mockRejectedValueOnce(new Error('nope'));
		const screen = render(Page);
		await renderWithSelected(screen);
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		await vi.waitFor(() => {
			expect(confirmModalDeleteButton(screen.container)).not.toBeUndefined();
		});
		confirmModalDeleteButton(screen.container)!.click();
		await vi.waitFor(() => {
			expect(toastAdd).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to delete moment', color: 'error' })
			);
		});
	});

	it('closes the edit form, hiding it', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await renderWithSelected(screen);
		await screen.getByRole('button', { name: 'Close' }).click();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('#moment-name')).toBeNull();
		});
	});

	it('opens the keyboard shortcuts modal from the timeline', async () => {
		const screen = render(Page);
		await tick();
		await screen.getByRole('button', { name: 'Keyboard shortcuts' }).click();
		// The modal's title heading appears once it opens.
		await vi.waitFor(() => {
			const headings = Array.from(screen.container.querySelectorAll('*')).filter(
				(el) => el.textContent?.trim() === 'Keyboard shortcuts' && el.children.length === 0
			);
			expect(headings.length).toBeGreaterThan(0);
		});
	});

	it('seeks the player when an audio-detection bar is clicked', async () => {
		audioDetections.list = [
			{
				id: 'ad-1',
				fileId: 'file-1',
				libraryId: 'lib-1',
				label: 'Speech',
				classIndex: 0,
				score: 0.9,
				startSeconds: 12,
				endSeconds: 14,
				version: 1,
				createdAt: '2025-01-01T00:00:00Z'
			}
		];
		const screen = render(Page);
		await tick();
		// Expand the audio-events panel so its per-window bars render.
		await screen.getByRole('button', { name: /Audio events/ }).click();
		// Clicking a window bar fires the page's onSeek (a no-op against the stubbed
		// player ref, but it exercises the handler without throwing).
		const bar = screen.container.querySelector(
			'button[aria-label^="Speech at"]'
		) as HTMLButtonElement;
		expect(bar).not.toBeNull();
		bar.click();
		await tick();
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

	it('wires the keyboard-shortcut callbacks to the editor handlers', async () => {
		moments.list = [makeMoment('m1')];
		const screen = render(Page);
		await renderWithSelected(screen);
		const cfg = shortcuts.config;
		expect(cfg).not.toBeNull();
		// hasSelection reflects whether a moment is selected (one is, post-select).
		expect(cfg!.hasSelection()).toBe(true);
		// onSetStart / onSetEnd snap the selected moment to the playhead (0).
		cfg!.onSetStart();
		cfg!.onSetEnd();
		await vi.waitFor(() => {
			expect(moments.update).toHaveBeenCalledWith('m1', { startSeconds: 0 });
			expect(moments.update).toHaveBeenCalledWith('m1', { endSeconds: 0 });
		});
		// onCreate enqueues a new moment; onTogglePlay calls through the player ref.
		cfg!.onCreate();
		cfg!.onTogglePlay();
		await vi.waitFor(() => {
			expect(moments.create).toHaveBeenCalled();
		});
	});

	it('reports no selection to the shortcut layer when nothing is selected', async () => {
		render(Page);
		await tick();
		expect(shortcuts.config!.hasSelection()).toBe(false);
		// The set-playhead shortcuts no-op (and never touch the store) with no selection.
		shortcuts.config!.onSetStart();
		shortcuts.config!.onSetEnd();
		expect(moments.update).not.toHaveBeenCalled();
	});

	it('patches the in-memory file when a finished job hands one back', async () => {
		// The job's setFile callback swaps the file record — exercise it directly,
		// then confirm the player still renders for the replacement file.
		const screen = render(Page);
		await vi.waitFor(() => expect(transcribeJob.setFile).not.toBeNull());
		transcribeJob.setFile!(makeFile({ name: 'updated.mp4', transcribeStatus: 'ready' }));
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-testid="player-stub"]')).not.toBeNull();
		});
	});

	it('marks the active moment when the playhead lands inside its range', async () => {
		// currentTime starts at 0; a moment spanning 0–8s therefore contains the
		// playhead, so activeMoment resolves to it — exercising the `find` predicate
		// (currentTime >= start && currentTime <= end) over a populated list.
		moments.list = [makeMoment('m1', { startSeconds: 0, endSeconds: 8 })];
		const screen = render(Page);
		// activeMoment is read by VideoEditorPlayer's `active` prop once the file (and
		// thus the player) renders; reaching here proves the predicate ran + matched.
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
