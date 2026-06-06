<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { ICONS } from '$lib/utils/icons';
	import { toast } from '$lib/state/toast';

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

	import VideoEditorPlayer from '$lib/components/editor/VideoEditorPlayer.svelte';
	import MomentTimeline from '$lib/components/editor/MomentTimeline.svelte';
	import MomentEditForm from '$lib/components/editor/MomentEditForm.svelte';
	import MomentsList from '$lib/components/editor/MomentsList.svelte';
	import EditorHeader from '$lib/components/editor/EditorHeader.svelte';
	import EditorKeyboardHelpModal from '$lib/components/editor/EditorKeyboardHelpModal.svelte';
	import AudioDetectionsPanel from '$lib/components/editor/AudioDetectionsPanel.svelte';
	import HighlightFiltersPanel from '$lib/components/editor/HighlightFiltersPanel.svelte';
	import TranscriptPanel from '$lib/components/editor/TranscriptPanel.svelte';
	import MomentShareModal from '$lib/components/editor/MomentShareModal.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';

	import type { Library, LibraryFile, Moment } from '$lib/types/api';
	import type { HighlightFilterPatch } from '$lib/types/api';

	const libraryId = $derived(page.params.id ?? '');
	const fileId = $derived(page.params.fileId ?? '');

	// The editor renders inside the dashboard shell, not the library subtree layout
	// (its own EditorHeader replaces the library breadcrumb/tabs), so it fetches the
	// library + file itself — mirroring the Nuxt page's two `useApiFetch` calls.
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

	const momentsStore = createLibraryMoments(
		() => libraryId,
		() => fileId
	);
	const moments = $derived<Moment[]>(momentsStore.moments);

	let playerRef = $state<VideoEditorPlayer | null>(null);
	let currentTime = $state(0);
	let duration = $state(0);
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
		moments.find((m) => currentTime >= m.startSeconds && currentTime <= m.endSeconds) ?? null
	);

	function goBack() {
		// The library page sets `?from=<folderId>` when the user opens the editor from
		// inside a folder. Restore that folder on the way back so they don't land at
		// the library root and have to re-navigate.
		const from = page.url.searchParams.get('from');
		const folderId = from && from.length > 0 ? from : null;
		const path = `/libraries/${libraryId}`;
		goto(folderId ? `${path}?folder=${encodeURIComponent(folderId)}` : path);
	}

	async function createAtPlayhead() {
		const start = currentTime;
		const end = Math.min(duration || start + 5, start + 5);
		try {
			const created = await momentsStore.create({
				name: '',
				description: '',
				startSeconds: start,
				endSeconds: end
			});
			selectedId = created.id;
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
			toast.add({ title: 'Moment saved', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to save moment', color: 'error' });
		}
	}

	function onSetPlayhead(field: 'start' | 'end') {
		if (!selectedMoment) return;
		const patch = field === 'start' ? { startSeconds: currentTime } : { endSeconds: currentTime };
		void momentsStore.update(selectedMoment.id, patch);
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
		try {
			await Promise.all(
				changes.map((c) =>
					momentsStore.update(c.id, { startSeconds: c.startSeconds, endSeconds: c.endSeconds })
				)
			);
			toast.add({ title: `Saved ${changes.length} moment(s)`, color: 'success' });
			await Promise.allSettled(changes.map((c) => momentsStore.triggerExport(c.id)));
		} catch {
			toast.add({ title: 'Failed to save changes', color: 'error' });
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

	async function onDeleteConfirm() {
		const id = pendingDeleteId;
		if (!id) return;
		pendingDeleteId = null;
		try {
			await momentsStore.remove(id);
			if (selectedId === id) selectedId = null;
			toast.add({ title: 'Moment deleted', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to delete moment', color: 'error' });
		}
	}

	function onSeek(seconds: number) {
		playerRef?.seek(seconds);
	}

	const shortcuts = createEditorShortcuts({
		hasSelection: () => selectedMoment !== null,
		onSetStart: () => onSetPlayhead('start'),
		onSetEnd: () => onSetPlayhead('end'),
		onCreate: () => void createAtPlayhead(),
		onTogglePlay: () => playerRef?.togglePlay()
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

	// Mirror the Vue watchers: re-run each store's status-driven side effect whenever
	// the file's relevant job status changes.
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
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
	<EditorHeader
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
	/>

	<!--
		Editor layout grid. Two columns at lg+: video on the left half, moments list
		on the right half. Below, every other panel (timeline, edit form, highlight
		filters, transcript, audio events) spans both columns at full width. On mobile
		the grid collapses to one column and everything stacks with video on top.
	-->
	<div
		class="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto px-0.5 lg:grid-cols-[3fr_2fr]"
	>
		<!--
			Row 1 cells get a defined height so the video player and moments list have
			something to fill. The video frame then uses a ResizeObserver inside this
			cell to compute the largest 16:9 rectangle that fits without clipping.
		-->
		{#if file}
			<div class="h-[60svh] max-h-[600px] min-h-[260px]">
				<VideoEditorPlayer
					bind:this={playerRef}
					{file}
					{libraryId}
					active={activeMoment !== null}
					oncurrenttimeupdate={(v) => (currentTime = v)}
					ondurationupdate={(v) => (duration = v)}
				/>
			</div>
		{/if}

		<div class="h-[60svh] max-h-[600px] min-h-[260px]">
			<MomentsList {moments} {selectedId} onselect={(id) => (selectedId = id)} />
		</div>

		<!--
			All panels below row 1 stack flush with no extra gap. Wrapping them in a
			single lg:col-span-2 flex-col stops `gap-4` on the outer grid from inserting
			space between them, while preserving the gap above (between the video/moments
			row and this stack).
		-->
		<div class="flex flex-col gap-4 lg:col-span-2">
			<MomentTimeline
				{duration}
				{currentTime}
				{moments}
				{selectedId}
				{waveformPeaks}
				{waveformPeaksPerSecond}
				onseek={onSeek}
				onselectMoment={(id) => (selectedId = id)}
				onsavePending={onSavePending}
				oncreateMoment={createAtPlayhead}
				onopenShortcuts={() => (shortcutsOpen = true)}
			/>

			{#if selectedMoment}
				<MomentEditForm
					moment={selectedMoment}
					{duration}
					downloadPending={downloads.isPending(selectedMoment.id)}
					onsave={onSaveForm}
					onsetToPlayhead={onSetPlayhead}
					ondelete={onDeleteRequest}
					onclose={() => (selectedId = null)}
					onexport={onExport}
					ondownload={(id) => downloads.request(id)}
					onshare={onShare}
				/>
			{/if}

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

			<TranscriptPanel cues={transcriptCues} {currentTime} onseek={onSeek} />

			<AudioDetectionsPanel detections={audioDetections} {duration} onseek={onSeek} />
		</div>
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
		confirmClass="btn-error"
		confirmIcon={ICONS.trash}
		onconfirm={onDeleteConfirm}
	/>
</div>
