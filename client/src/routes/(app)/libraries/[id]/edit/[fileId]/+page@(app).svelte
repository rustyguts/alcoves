<script lang="ts">
	/**
	 * Video editor — NLE-style moment-clipping workspace for one file.
	 *
	 * The page is the single state owner: it fetches the library + file itself
	 * (the @(app) layout reset means no library-subtree layout/loader runs),
	 * instantiates every store, and wires children purely through props +
	 * callback props. Layout: top bar, then player + transport on the left with
	 * the tabbed inspector on the right (lg+), and the full-width multi-track
	 * timeline docked at the bottom. Below lg everything stacks (player,
	 * transport, timeline, inspector) and the page scrolls.
	 *
	 * Keyboard input is owned by ONE window listener (editor-shortcuts) that is
	 * suspended while a modal is open and ignores keys consumed by focused
	 * buttons or timeline bars.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { goto, beforeNavigate } from '$app/navigation';
	import { api } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import { toast } from '$lib/state/toast';
	import {
		formatTimecode,
		splitName,
		MIN_MOMENT_SECONDS,
		type TimelineController,
		type TimelineMarker
	} from '$lib/utils/timeline-geometry';

	import { createLibraryMoments } from '$lib/state/library-moments.svelte';
	import { createTranscript } from '$lib/state/transcript.svelte';
	import { createTranscribeJob } from '$lib/state/transcribe-job.svelte';
	import { createAudioDetections } from '$lib/state/audio-detections.svelte';
	import { createAudioDetectJob } from '$lib/state/audio-detect-job.svelte';
	import { createWaveform } from '$lib/state/waveform.svelte';
	import { createWaveformJob } from '$lib/state/waveform-job.svelte';
	import { createEditorHighlights } from '$lib/state/editor-highlights.svelte';
	import { createMomentDownloads } from '$lib/state/moment-downloads.svelte';
	import { createEditorShortcuts } from '$lib/state/editor-shortcuts';
	import { createPlayback } from '$lib/state/playback.svelte';
	import { createEditorPreferences, type InspectorTab } from '$lib/state/editor-preferences.svelte';

	import EditorTopBar from '$lib/components/editor/EditorTopBar.svelte';
	import VideoEditorPlayer from '$lib/components/editor/VideoEditorPlayer.svelte';
	import TransportBar from '$lib/components/editor/TransportBar.svelte';
	import Timeline from '$lib/components/editor/timeline/Timeline.svelte';
	import InspectorPanel from '$lib/components/editor/InspectorPanel.svelte';
	import MomentsList from '$lib/components/editor/MomentsList.svelte';
	import MomentEditForm from '$lib/components/editor/MomentEditForm.svelte';
	import TranscriptPanel from '$lib/components/editor/TranscriptPanel.svelte';
	import AudioDetectionsPanel from '$lib/components/editor/AudioDetectionsPanel.svelte';
	import HighlightFiltersPanel from '$lib/components/editor/HighlightFiltersPanel.svelte';
	import MomentShareModal from '$lib/components/editor/MomentShareModal.svelte';
	import EditorKeyboardHelpModal from '$lib/components/editor/EditorKeyboardHelpModal.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import * as Tabs from '$lib/components/ui/tabs/index.js';

	import type { Library, LibraryFile, Moment } from '$lib/types/api';
	import type { HighlightFilterPatch } from '$lib/types/api';

	const libraryId = $derived(page.params.id ?? '');
	const fileId = $derived(page.params.fileId ?? '');

	// The editor renders inside the dashboard shell, not the library subtree
	// layout, so it fetches the library + file itself.
	let library = $state<Library | null>(null);
	let file = $state<LibraryFile | null>(null);

	async function refreshLibrary() {
		try {
			library = await api.libraries.get(libraryId);
		} catch {
			/* ignore */
		}
	}

	function setFile(f: LibraryFile) {
		file = f;
	}

	async function refreshFile() {
		try {
			file = await api.files.get(libraryId, fileId);
		} catch {
			/* ignore */
		}
	}

	// — stores —

	const momentsStore = createLibraryMoments(
		() => libraryId,
		() => fileId
	);
	const moments = $derived<Moment[]>(momentsStore.moments);

	const playback = createPlayback();
	const prefs = createEditorPreferences();

	let timelineController = $state<TimelineController | null>(null);
	let selectedId = $state<string | null>(null);
	let pendingDeleteId = $state<string | null>(null);
	let shortcutsOpen = $state(false);

	const audioDetectionsStore = createAudioDetections(
		() => libraryId,
		() => fileId
	);
	const audioDetections = $derived(audioDetectionsStore.detections);

	const transcriptStore = createTranscript(
		() => libraryId,
		() => fileId,
		() => file
	);
	const transcriptVtt = $derived(transcriptStore.vtt);
	const transcriptCues = $derived(transcriptStore.cues);

	const transcribeJob = createTranscribeJob(
		() => libraryId,
		() => fileId,
		() => file,
		setFile,
		refreshFile
	);
	const audioDetectJob = createAudioDetectJob(
		() => libraryId,
		() => fileId,
		() => file,
		refreshFile,
		() => audioDetectionsStore.refresh(),
		setFile
	);

	const waveformStore = createWaveform(
		() => libraryId,
		() => fileId,
		() => file
	);
	const waveformPeaks = $derived(waveformStore.peaks);
	const waveformPeaksPerSecond = $derived(waveformStore.peaksPerSecond);

	const waveformJob = createWaveformJob(
		() => libraryId,
		() => fileId,
		() => file,
		setFile,
		refreshFile
	);

	const canDetectAudio = $derived(file?.transcribeStatus === 'ready');
	const isAudio = $derived(!!file?.mimeType && file.mimeType.startsWith('audio/'));

	const highlights = createEditorHighlights(
		() => libraryId,
		() => audioDetections,
		() => transcriptVtt
	);

	const downloads = createMomentDownloads({
		getLibraryId: () => libraryId,
		getFileId: () => fileId,
		getMoments: () => moments,
		triggerExport: (momentId: string) => momentsStore.triggerExport(momentId)
	});

	const selectedMoment = $derived<Moment | null>(moments.find((m) => m.id === selectedId) ?? null);

	const activeMoment = $derived<Moment | null>(
		moments.find(
			(m) => playback.currentTime >= m.startSeconds && playback.currentTime <= m.endSeconds
		) ?? null
	);

	// Highlight-filter matches rendered as colored markers on the timeline.
	const markers = $derived.by<TimelineMarker[]>(() => {
		const out: TimelineMarker[] = [];
		for (const f of highlights.filters) {
			const list = highlights.matches[f.id] ?? [];
			for (let i = 0; i < list.length; i++) {
				const m = list[i]!;
				out.push({
					id: `${f.id}-${i}`,
					filterId: f.id,
					name: f.name,
					color: f.color,
					startSeconds: m.startSeconds,
					title: `${f.name} · ${formatTimecode(m.startSeconds)} · ${m.evidence.join(' + ')}`
				});
			}
		}
		return out;
	});

	const inspectorTabs = $derived([
		{ id: 'moments', label: 'Moments', icon: ICONS.movie, count: moments.length },
		{ id: 'transcript', label: 'Transcript', icon: ICONS.transcript, count: transcriptCues.length },
		{
			id: 'highlights',
			label: 'Highlights',
			icon: ICONS.highlights,
			count: highlights.filters.length
		},
		{ id: 'audio', label: 'Audio', icon: ICONS.audioDetect, count: audioDetections.length }
	]);

	// — selection —

	function selectMoment(id: string) {
		selectedId = id;
		// Selecting from the timeline while another tab is open would otherwise
		// look like a no-op — pull the inspector onto the Moments tab.
		prefs.setInspectorTab('moments');
		// Below lg the inspector stacks BELOW the timeline; a tap on a bar would
		// open the edit form off-screen with no affordance, so bring it into view.
		if (browser && !window.matchMedia('(min-width: 64rem)').matches) {
			setTimeout(() => {
				document
					.querySelector('[data-testid="inspector"]')
					?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			}, 0);
		}
	}

	function deselectMoment() {
		selectedId = null;
		playback.disarmLoop();
	}

	// The selected moment can vanish underneath us (deleted elsewhere, poll
	// refresh) — drop selection and disarm the loop instead of going stale.
	$effect(() => {
		if (selectedId && !moments.some((m) => m.id === selectedId)) deselectMoment();
	});

	function goBack() {
		// The library page sets `?from=<folderId>` when the editor was opened
		// from inside a folder; restore that folder on the way back.
		const from = page.url.searchParams.get('from');
		const folderId = from && from.length > 0 ? from : null;
		const path = `/libraries/${libraryId}`;
		goto(folderId ? `${path}?folder=${encodeURIComponent(folderId)}` : path);
	}

	// — moment mutations —

	async function createAtPlayhead() {
		// Clamp back from the very end of the media so a minimum-length moment
		// always fits — at currentTime == duration a naive [t, min(d, t+5)] is
		// zero-length and the backend rejects it.
		const d = playback.duration;
		const start =
			d > 0
				? Math.min(playback.currentTime, Math.max(0, d - MIN_MOMENT_SECONDS))
				: playback.currentTime;
		const end = d > 0 ? Math.min(d, start + 5) : start + 5;
		try {
			const created = await momentsStore.create({
				name: '',
				description: '',
				startSeconds: start,
				endSeconds: end
			});
			selectMoment(created.id);
			toast.add({ title: 'Moment created', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to create moment', color: 'error' });
		}
	}

	async function onSaveForm(patch: {
		name: string;
		description: string;
		startSeconds: number;
		endSeconds: number;
	}) {
		if (!selectedMoment) return;
		try {
			await momentsStore.update(selectedMoment.id, patch);
			// The form's values are what the user sees — they win over any
			// pending drag edit for the same moment.
			timelineController?.clearPending(selectedMoment.id);
			toast.add({ title: 'Moment saved', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to save moment', color: 'error' });
		}
	}

	function effectiveRangeOf(m: Moment): { startSeconds: number; endSeconds: number } {
		return (
			timelineController?.getEffectiveRange(m.id) ?? {
				startSeconds: m.startSeconds,
				endSeconds: m.endSeconds
			}
		);
	}

	async function onSetPlayhead(field: 'start' | 'end') {
		const m = selectedMoment;
		if (!m) return;
		// WYSIWYG: commit the effective (pending-merged) range with the chosen
		// edge moved to the playhead, then clear the committed pending entry.
		const range = effectiveRangeOf(m);
		const t = playback.currentTime;
		const patch =
			field === 'start'
				? {
						startSeconds: Math.min(t, range.endSeconds - 0.05),
						endSeconds: range.endSeconds
					}
				: {
						startSeconds: range.startSeconds,
						endSeconds: Math.max(t, range.startSeconds + 0.05)
					};
		patch.startSeconds = Math.max(0, patch.startSeconds);
		try {
			await momentsStore.update(m.id, patch);
			timelineController?.clearPending(m.id);
		} catch {
			toast.add({ title: 'Failed to update moment', color: 'error' });
		}
	}

	async function splitAtPlayhead() {
		const m = selectedMoment;
		if (!m) return;
		const range = effectiveRangeOf(m);
		const t = playback.currentTime;
		// Needs ≥0.05s on both sides of the cut.
		if (t - range.startSeconds < 0.05 || range.endSeconds - t < 0.05) return;
		let created: Moment;
		try {
			// Create the right-hand half FIRST: if this fails nothing changed.
			created = await momentsStore.create({
				name: splitName(m.name),
				description: m.description,
				startSeconds: t,
				endSeconds: range.endSeconds
			});
		} catch {
			toast.add({ title: 'Failed to split moment', color: 'error' });
			return;
		}
		try {
			await momentsStore.update(m.id, { startSeconds: range.startSeconds, endSeconds: t });
			timelineController?.clearPending(m.id);
			selectMoment(created.id);
			toast.add({
				title: 'Moment split',
				description: `${m.name || 'Untitled'} → ${created.name || 'Untitled'}`,
				color: 'success'
			});
		} catch {
			// The new clip exists but the original kept its full range — the
			// overlap is recoverable (adjust or delete one), so say exactly that.
			toast.add({
				title: 'Split incomplete',
				description:
					'The new clip was created but the original kept its range — adjust or delete one.',
				color: 'error'
			});
		}
	}

	async function onExport(momentId: string) {
		try {
			await momentsStore.triggerExport(momentId);
			toast.add({ title: 'Export queued', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to queue export', color: 'error' });
		}
	}

	async function onSavePending(
		changes: Array<{ id: string; startSeconds: number; endSeconds: number }>
	) {
		if (changes.length === 0) return;
		// Settle every PATCH independently: failed entries stay pending on the
		// timeline (the server never echoes their values, so the reconcile
		// effect keeps them dirty and recoverable) while successful siblings
		// reconcile away and re-export.
		const results = await Promise.allSettled(
			changes.map((c) =>
				momentsStore.update(c.id, { startSeconds: c.startSeconds, endSeconds: c.endSeconds })
			)
		);
		const saved = changes.filter((_, i) => results[i]?.status === 'fulfilled');
		const failed = changes.length - saved.length;
		if (saved.length > 0) {
			toast.add({ title: `Saved ${saved.length} moment(s)`, color: 'success' });
			await Promise.allSettled(saved.map((c) => momentsStore.triggerExport(c.id)));
		}
		if (failed > 0) {
			toast.add({
				title: `Failed to save ${failed} moment(s)`,
				description: 'The unsaved edits are still highlighted on the timeline.',
				color: 'error'
			});
		}
	}

	let shareMomentId = $state<string | null>(null);
	let shareOpen = $state(false);

	function onShare(momentId: string) {
		if (!library?.sharingEnabled) {
			toast.add({
				title: 'Sharing is disabled for this library',
				description: 'Enable it in library settings to create share links.',
				color: 'warning'
			});
			return;
		}
		shareMomentId = momentId;
		shareOpen = true;
	}

	function onDeleteRequest(momentId: string) {
		pendingDeleteId = momentId;
	}

	function requestDeleteSelected() {
		if (selectedId) pendingDeleteId = selectedId;
	}

	async function onDeleteConfirm() {
		const id = pendingDeleteId;
		if (!id) return;
		pendingDeleteId = null;
		try {
			await momentsStore.remove(id);
			if (selectedId === id) deselectMoment();
			toast.add({ title: 'Moment deleted', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to delete moment', color: 'error' });
		}
	}

	function onSeek(seconds: number) {
		playback.seek(seconds);
	}

	function jumpToMoment(momentId: string) {
		const m = moments.find((x) => x.id === momentId);
		if (m) playback.seek(m.startSeconds);
	}

	function toggleLoopSelected() {
		if (!selectedMoment) return;
		playback.toggleLoop();
	}

	// — keyboard —

	const shortcuts = createEditorShortcuts({
		isSuspended: () => shareOpen || shortcutsOpen || pendingDeleteId !== null,
		onTogglePlay: () => playback.togglePlay(),
		onJump: (seconds) => playback.jump(seconds),
		onStepFrame: (frames) => playback.stepFrame(frames),
		onCreate: () => void createAtPlayhead(),
		onSetStart: () => void onSetPlayhead('start'),
		onSetEnd: () => void onSetPlayhead('end'),
		onSplit: () => void splitAtPlayhead(),
		onRequestDelete: requestDeleteSelected,
		onZoomIn: () => timelineController?.zoomIn(),
		onZoomOut: () => timelineController?.zoomOut(),
		onZoomFit: () => timelineController?.zoomToFit(),
		onScroll: (direction) => timelineController?.scrollStep(direction),
		onCenter: () => timelineController?.centerPlayhead(),
		onToggleSnap: () => prefs.toggleSnapping(),
		onToggleLoop: toggleLoopSelected,
		onOpenHelp: () => (shortcutsOpen = true)
	});

	// Unsaved timeline drags are local-only — confirm before navigating away.
	beforeNavigate((navigation) => {
		if (!timelineController?.hasPending()) return;
		if (!confirm('Discard unsaved moment changes?')) navigation.cancel();
	});

	onMount(async () => {
		shortcuts.attach();
		await refreshLibrary();
		await refreshFile();
		await momentsStore.refresh();
		await highlights.refresh();
	});

	onDestroy(() => {
		shortcuts.detach();
		momentsStore.dispose();
		transcribeJob.stop();
		audioDetectJob.stop();
		waveformJob.stop();
	});

	// Status-driven side effects: re-run each store's sync whenever the file's
	// relevant job status changes.
	$effect(() => {
		void file?.transcribeStatus;
		transcriptStore.sync();
	});
	$effect(() => {
		void file?.transcribeStatus;
		void file?.transcribeError;
		transcribeJob.sync();
	});
	$effect(() => {
		void file?.audioDetectStatus;
		void file?.audioDetectError;
		audioDetectJob.sync();
	});
	$effect(() => {
		void file?.waveformStatus;
		void file?.waveformedVersion;
		void waveformStore.refresh();
	});
	$effect(() => {
		void file?.waveformStatus;
		void file?.waveformError;
		waveformJob.sync();
	});
	// Refresh audio detections when the file id resolves/changes.
	$effect(() => {
		void file?.id;
		void audioDetectionsStore.refresh();
	});
	// Start the moments export poller whenever a moment is in flight.
	$effect(() => {
		if (momentsStore.hasInFlight) momentsStore.startPolling();
	});
	// Reconcile the download queue against the latest moments list.
	$effect(() => {
		void moments;
		downloads.sync();
	});
	// Loop the selected moment while armed.
	$effect(() => {
		playback.applyLoop(
			selectedMoment
				? { startSeconds: selectedMoment.startSeconds, endSeconds: selectedMoment.endSeconds }
				: null
		);
	});
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:overflow-hidden">
	<div class="order-1 shrink-0 lg:order-none">
		<EditorTopBar
			{file}
			transcribing={transcribeJob.running}
			transcribeButton={transcribeJob.button}
			audioDetecting={audioDetectJob.detecting}
			audioDetectButton={audioDetectJob.button}
			{canDetectAudio}
			waveformGenerating={waveformJob.generating}
			waveformButton={waveformJob.button}
			onback={goBack}
			ontranscribe={() => transcribeJob.run()}
			onaudioDetect={() => audioDetectJob.run()}
			onwaveform={() => waveformJob.run()}
			onopenShortcuts={() => (shortcutsOpen = true)}
		/>
	</div>

	<!--
		Workspace. `contents` below lg flattens these wrappers so the page's
		flex-col + order utilities control the mobile stacking (player, transport,
		timeline, inspector) with a SINGLE instance of every panel; at lg+ they
		become real flex boxes: player+transport column, inspector right rail.
	-->
	<div class="contents lg:flex lg:min-h-0 lg:flex-1 lg:gap-3">
		<div class="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-3">
			<div class="order-2 aspect-video w-full lg:order-none lg:aspect-auto lg:min-h-0 lg:flex-1">
				{#if file}
					<VideoEditorPlayer
						{file}
						{libraryId}
						active={activeMoment !== null}
						oncurrenttimeupdate={(v) => playback.onTime(v)}
						ondurationupdate={(v) => playback.onDuration(v)}
						onpausedupdate={(v) => playback.onPaused(v)}
						onratechange={(v) => playback.onRate(v)}
						onvolumechange={(v, m) => playback.onVolume(v, m)}
						oncontroller={(c) => playback.setController(c)}
					/>
				{/if}
			</div>

			<div class="order-3 shrink-0 lg:order-none">
				<TransportBar
					currentTime={playback.currentTime}
					duration={playback.duration}
					paused={playback.paused}
					rate={playback.rate}
					loop={playback.loop}
					muted={playback.muted}
					volume={playback.volume}
					hasSelection={selectedMoment !== null}
					{isAudio}
					ontoggleplay={() => playback.togglePlay()}
					onstepframe={(n) => playback.stepFrame(n)}
					onjump={(s) => playback.jump(s)}
					onsetrate={(r) => playback.setRate(r)}
					ontoggleloop={toggleLoopSelected}
					ontogglemute={() => playback.toggleMute()}
					onsetvolume={(v) => playback.setVolume(v)}
					onfullscreen={() => playback.enterFullscreen()}
				/>
			</div>
		</div>

		<InspectorPanel
			tabs={inspectorTabs}
			active={prefs.inspectorTab}
			width={prefs.inspectorWidth}
			onselecttab={(id) => prefs.setInspectorTab(id as InspectorTab)}
			onwidthchange={(w) => prefs.setInspectorWidth(w)}
			class="order-5 lg:order-none"
		>
			<!-- Every tab stays MOUNTED — bits-ui's Tabs.Content hides inactive
			     panels via the `hidden` attribute rather than unmounting them, so
			     search boxes and in-progress forms survive tab switches. -->
			<Tabs.Content value="moments" id="inspector-panel-moments" class="flex flex-col gap-3">
				{#if selectedMoment}
					<MomentEditForm
						moment={selectedMoment}
						duration={playback.duration}
						downloadPending={downloads.isPending(selectedMoment.id)}
						onsave={onSaveForm}
						onsetToPlayhead={(field) => void onSetPlayhead(field)}
						onjumpto={(seconds) => playback.seek(seconds)}
						ondelete={onDeleteRequest}
						onclose={deselectMoment}
						onexport={onExport}
						ondownload={(id) => downloads.request(id)}
						onshare={onShare}
					/>
				{/if}
				<MomentsList
					{moments}
					{selectedId}
					onselect={selectMoment}
					onjumpto={jumpToMoment}
					oncreate={() => void createAtPlayhead()}
				/>
			</Tabs.Content>

			<Tabs.Content value="transcript" id="inspector-panel-transcript">
				<TranscriptPanel
					cues={transcriptCues}
					currentTime={playback.currentTime}
					onseek={onSeek}
					jobButton={transcribeJob.button}
					onrunjob={() => transcribeJob.run()}
				/>
			</Tabs.Content>

			<Tabs.Content value="highlights" id="inspector-panel-highlights">
				<HighlightFiltersPanel
					filters={highlights.filters}
					matches={highlights.matches}
					aggregates={highlights.aggregates}
					loading={highlights.loading}
					hasSignals={highlights.hasSignals}
					onseek={onSeek}
					oncreate={highlights.onCreate}
					onupdate={(id: string, body: HighlightFilterPatch) => highlights.onUpdate(id, body)}
					onremove={highlights.onRemove}
					onloadpresets={highlights.onLoadPresets}
				/>
			</Tabs.Content>

			<Tabs.Content value="audio" id="inspector-panel-audio">
				<AudioDetectionsPanel
					detections={audioDetections}
					duration={playback.duration}
					onseek={onSeek}
					jobButton={audioDetectJob.button}
					{canDetectAudio}
					onrunjob={() => audioDetectJob.run()}
				/>
			</Tabs.Content>
		</InspectorPanel>
	</div>

	<div class="order-4 shrink-0 lg:order-none">
		<Timeline
			duration={playback.duration}
			currentTime={playback.currentTime}
			{moments}
			{selectedId}
			{waveformPeaks}
			{waveformPeaksPerSecond}
			{markers}
			snapping={prefs.snapping}
			onseek={onSeek}
			onselectMoment={selectMoment}
			onsavePending={onSavePending}
			oncreateMoment={() => void createAtPlayhead()}
			onsplit={() => void splitAtPlayhead()}
			ontogglesnap={() => prefs.toggleSnapping()}
			oncontroller={(c) => (timelineController = c)}
		/>
	</div>

	<MomentShareModal
		bind:open={shareOpen}
		{libraryId}
		{fileId}
		momentId={shareMomentId}
		sharingEnabled={library?.sharingEnabled ?? false}
	/>

	<EditorKeyboardHelpModal bind:open={shortcutsOpen} />

	<ConfirmModal
		open={pendingDeleteId !== null}
		title="Delete moment?"
		message="This moment will be moved to trash. Any cached exports will be deleted."
		confirmLabel="Delete"
		confirmClass="error"
		confirmIcon={ICONS.trash}
		onconfirm={onDeleteConfirm}
		oncancel={() => (pendingDeleteId = null)}
	/>
</div>
