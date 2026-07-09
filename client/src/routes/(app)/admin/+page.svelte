<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, apiUrl, ApiError } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import { ICONS } from '$lib/utils/icons';
	import { formatFileSize } from '$lib/utils/mime-icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AppPanel from '$lib/components/ui/AppPanel.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
	import AdminJobsPanel from '$lib/components/admin/AdminJobsPanel.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { AdminStats, AdminUser, AppSettings, RegistrationMode } from '$lib/types/api';

	const currentUser = $derived(page.data.user);

	let stats = $state<AdminStats | null>(null);
	let users = $state<AdminUser[] | null>(null);
	let usersStatus = $state<'pending' | 'success' | 'error'>('pending');
	let settings = $state<AppSettings | null>(null);

	interface VersionInfo {
		commit: string;
		buildTime: string;
		dirty: boolean;
		mode: string;
	}
	let versionInfo = $state<VersionInfo | null>(null);

	onMount(() => {
		void loadStats();
		void loadUsers();
		void loadSettings();
		void loadVersion();
	});

	let statsError = $state(false);
	async function loadStats() {
		statsError = false;
		try {
			stats = await api.admin.stats();
		} catch {
			stats = null;
			statsError = true;
		}
	}

	async function loadUsers() {
		usersStatus = 'pending';
		try {
			users = await api.admin.listUsers();
			usersStatus = 'success';
		} catch {
			users = [];
			usersStatus = 'error';
		}
	}

	let settingsError = $state(false);
	async function loadSettings() {
		settingsError = false;
		try {
			settings = await api.admin.getSettings();
		} catch {
			settings = null;
			settingsError = true;
		}
	}

	async function loadVersion() {
		try {
			const res = await fetch(apiUrl('/api/version'), { credentials: 'include' });
			if (res.ok) versionInfo = (await res.json()) as VersionInfo;
		} catch {
			versionInfo = null;
		}
	}

	function errorMessage(error: unknown, fallback: string): string {
		if (error instanceof ApiError || error instanceof Error) return error.message;
		return fallback;
	}

	// ─── Registration mode ─────────────────────────────────
	const registrationModes: { value: RegistrationMode; label: string; description: string }[] = [
		{ value: 'open', label: 'Open', description: 'Anyone can create an account.' },
		{
			value: 'invite_only',
			label: 'Invite only',
			description: 'Registration requires a library invite link.'
		},
		{
			value: 'closed',
			label: 'Closed',
			description: 'Nobody can create an account. Library invites are disabled.'
		}
	];

	let updatingRegistrationMode = $state(false);
	async function updateRegistrationMode(next: RegistrationMode) {
		if (!settings || next === settings.registration_mode) return;
		// F3 fix: optimistically write the new mode into `settings` so the
		// RadioGroup's one-way `value` prop tracks it immediately. On failure we
		// write the previous mode back — a genuine value change, not a no-op —
		// which forces the RadioGroup to re-derive its prop (fixing the display)
		// and clears bits-ui's "already selected" guard (fixing the inert
		// re-click, per .agents/specs/shadcn-rewrite/07-rework-findings.md F3).
		const previous = settings.registration_mode;
		settings.registration_mode = next;
		updatingRegistrationMode = true;
		try {
			settings = await api.admin.updateSettings({ registration_mode: next });
			toast.add({ title: 'Registration mode updated', color: 'success' });
		} catch (error: unknown) {
			settings.registration_mode = previous;
			toast.add({ title: errorMessage(error, 'Failed to update settings'), color: 'error' });
		} finally {
			updatingRegistrationMode = false;
		}
	}

	// ─── Inference model catalogs ──────────────────────────
	// Static metadata for the admin selectors. The backend enforces the
	// allow-list (see backend/internal/services/transcribe/whisper_models.go
	// and backend/internal/services/audiodetection/registry.go); these
	// dictionaries only drive the descriptions / RAM callouts in the UI. If
	// the lists drift, the backend rejects unknown IDs and the admin sees a
	// toast — but keep them in sync to avoid that friction.

	interface WhisperModelOption {
		id: string;
		label: string;
		diskMB: number;
		ramPeakMB: number;
		realtime: number; // x-realtime factor on CPU
		werClean: number; // LibriSpeech test-clean WER %
		werOther: number;
		english: boolean;
		notes: string;
	}

	const whisperModels: WhisperModelOption[] = [
		{
			id: 'tiny',
			label: 'tiny',
			diskMB: 75,
			ramPeakMB: 390,
			realtime: 50,
			werClean: 7.5,
			werOther: 16,
			english: false,
			notes: 'Fastest, weak accuracy.'
		},
		{
			id: 'base',
			label: 'base',
			diskMB: 142,
			ramPeakMB: 500,
			realtime: 32,
			werClean: 5.0,
			werOther: 12,
			english: false,
			notes: 'Fast fallback for low-RAM hosts.'
		},
		{
			id: 'small',
			label: 'small',
			diskMB: 466,
			ramPeakMB: 1000,
			realtime: 16,
			werClean: 3.4,
			werOther: 7.6,
			english: false,
			notes: 'Mid-tier.'
		},
		{
			id: 'medium',
			label: 'medium',
			diskMB: 1500,
			ramPeakMB: 2500,
			realtime: 6,
			werClean: 3.0,
			werOther: 6.0,
			english: false,
			notes: 'Strong accuracy within homelab memory limits.'
		},
		{
			id: 'large-v3',
			label: 'large-v3 (default)',
			diskMB: 3100,
			ramPeakMB: 3900,
			realtime: 1,
			werClean: 2.7,
			werOther: 5.2,
			english: false,
			notes: 'Best WER; ≥4 GB RAM recommended.'
		},
		{
			id: 'large-v3-q5_0',
			label: 'large-v3 q5_0',
			diskMB: 1080,
			ramPeakMB: 1300,
			realtime: 3,
			werClean: 2.9,
			werOther: 5.4,
			english: false,
			notes: 'Quantized; reasonable accuracy/size tradeoff.'
		},
		{
			id: 'large-v3-turbo-q5_0',
			label: 'large-v3-turbo q5_0',
			diskMB: 574,
			ramPeakMB: 900,
			realtime: 10,
			werClean: 3.0,
			werOther: 5.5,
			english: false,
			notes: '8× faster than v3, near-v3 WER.'
		},
		{
			id: 'large-v3-turbo-q4_0',
			label: 'large-v3-turbo q4_0',
			diskMB: 470,
			ramPeakMB: 800,
			realtime: 12,
			werClean: 3.2,
			werOther: 5.8,
			english: false,
			notes: 'Smallest near-SOTA option.'
		},
		{
			id: 'distil-large-v3.5-q5',
			label: 'distil-large-v3.5 q5 (EN)',
			diskMB: 600,
			ramPeakMB: 1000,
			realtime: 15,
			werClean: 3.0,
			werOther: 5.6,
			english: true,
			notes: 'English-only; faster than turbo.'
		}
	];

	const whisperLanguages: { id: string; label: string }[] = [
		{ id: 'auto', label: 'Auto-detect' },
		{ id: 'en', label: 'English' },
		{ id: 'fr', label: 'French' },
		{ id: 'de', label: 'German' },
		{ id: 'es', label: 'Spanish' },
		{ id: 'it', label: 'Italian' },
		{ id: 'pt', label: 'Portuguese' },
		{ id: 'nl', label: 'Dutch' },
		{ id: 'ja', label: 'Japanese' },
		{ id: 'zh', label: 'Chinese' },
		{ id: 'ko', label: 'Korean' },
		{ id: 'ru', label: 'Russian' }
	];

	interface AudioTaggerOption {
		id: string;
		label: string;
		diskMB: number;
		ramPeakMB: number;
		mAP: number;
		license: string;
		notes: string;
		// available mirrors audiodetection.ModelSpec.Available on the backend: a
		// model is only selectable once its ONNX artifact is published to the model
		// bucket. Unpublished entries stay listed (disabled) so the roadmap is
		// visible, but picking one would 404 the worker — the backend rejects it too.
		available: boolean;
	}

	const audioTaggers: AudioTaggerOption[] = [
		{
			id: 'efficientat_mn04',
			label: 'EfficientAT mn04_as (tiny)',
			diskMB: 5,
			ramPeakMB: 60,
			mAP: 0.432,
			license: 'MIT',
			notes: 'Same mAP as CNN14 at ~80× smaller. Best for ultra-constrained pods.',
			available: false
		},
		{
			id: 'efficientat_mn10',
			label: 'EfficientAT mn10_as (default)',
			diskMB: 20,
			ramPeakMB: 120,
			mAP: 0.471,
			license: 'MIT',
			notes: '~16× smaller than CNN14, +9% mAP, faster on CPU.',
			available: true
		},
		{
			id: 'efficientat_mn40',
			label: 'EfficientAT mn40_as_ext',
			diskMB: 280,
			ramPeakMB: 500,
			mAP: 0.487,
			license: 'MIT',
			notes: 'Same disk class as CNN14, +5.6 mAP. Slower CPU inference.',
			available: false
		},
		{
			id: 'ced_tiny',
			label: 'CED-Tiny',
			diskMB: 22,
			ramPeakMB: 120,
			mAP: 0.481,
			license: 'Apache-2.0',
			notes: 'Transformer; CPU parity with MobileNetV3.',
			available: false
		},
		{
			id: 'ced_small',
			label: 'CED-Small',
			diskMB: 85,
			ramPeakMB: 280,
			mAP: 0.496,
			license: 'Apache-2.0',
			notes: 'Best mid-range quality.',
			available: false
		},
		{
			id: 'ced_base',
			label: 'CED-Base (premium)',
			diskMB: 330,
			ramPeakMB: 600,
			mAP: 0.5,
			license: 'Apache-2.0',
			notes: 'SOTA-class quality.',
			available: false
		},
		{
			id: 'pann_cnn14',
			label: 'PANNs CNN14 (legacy)',
			diskMB: 313,
			ramPeakMB: 600,
			mAP: 0.431,
			license: 'Apache-2.0',
			notes: 'Original baseline. Kept as rollback option.',
			available: true
		}
	];

	function formatMB(mb: number): string {
		if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
		return `${mb} MB`;
	}

	const whisperModel = $derived(settings?.whisper_model ?? 'large-v3');
	const whisperLanguage = $derived(settings?.whisper_language ?? 'auto');
	const audioTagger = $derived(settings?.audio_detect_model ?? 'efficientat_mn10');

	const selectedWhisper = $derived(whisperModels.find((m) => m.id === whisperModel) ?? null);
	const selectedAudioTagger = $derived(audioTaggers.find((m) => m.id === audioTagger) ?? null);

	const whisperModelLabel = $derived(selectedWhisper?.label ?? whisperModel);
	const whisperLanguageLabel = $derived(
		whisperLanguages.find((l) => l.id === whisperLanguage)?.label ?? whisperLanguage
	);
	const audioTaggerLabel = $derived(
		selectedAudioTagger
			? selectedAudioTagger.available
				? selectedAudioTagger.label
				: `${selectedAudioTagger.label} — not yet available`
			: audioTagger
	);

	// The whisper/audio Selects share the same one-way `value` desync as the
	// registration-mode RadioGroup (F3): their Trigger *label* self-heals
	// because it's derived separately from `settings`, but the Select's
	// internal selection (the checkmark, and whether re-picking the rejected
	// item is inert) is driven by the `value` prop itself. Same optimistic
	// set + explicit revert-on-failure fix as above.
	let updatingWhisper = $state(false);
	async function updateWhisperModel(next: string) {
		if (!settings || next === (settings.whisper_model ?? 'large-v3')) return;
		const previous = settings.whisper_model;
		settings.whisper_model = next;
		updatingWhisper = true;
		try {
			settings = await api.admin.updateSettings({ whisper_model: next });
			toast.add({ title: `Transcription model: ${next}`, color: 'success' });
		} catch (error: unknown) {
			settings.whisper_model = previous;
			toast.add({ title: errorMessage(error, 'Failed to update model'), color: 'error' });
		} finally {
			updatingWhisper = false;
		}
	}

	async function updateWhisperLanguage(next: string) {
		if (!settings || next === (settings.whisper_language ?? 'auto')) return;
		const previous = settings.whisper_language;
		settings.whisper_language = next;
		updatingWhisper = true;
		try {
			settings = await api.admin.updateSettings({ whisper_language: next });
			toast.add({ title: `Transcription language: ${next}`, color: 'success' });
		} catch (error: unknown) {
			settings.whisper_language = previous;
			toast.add({ title: errorMessage(error, 'Failed to update language'), color: 'error' });
		} finally {
			updatingWhisper = false;
		}
	}

	let updatingAudioTagger = $state(false);
	async function updateAudioTagger(next: string) {
		if (!settings || next === (settings.audio_detect_model ?? 'efficientat_mn10')) return;
		const previous = settings.audio_detect_model;
		settings.audio_detect_model = next;
		updatingAudioTagger = true;
		try {
			settings = await api.admin.updateSettings({ audio_detect_model: next });
			toast.add({ title: `Audio tagger: ${next}`, color: 'success' });
		} catch (error: unknown) {
			settings.audio_detect_model = previous;
			toast.add({ title: errorMessage(error, 'Failed to update audio tagger'), color: 'error' });
		} finally {
			updatingAudioTagger = false;
		}
	}

	// ─── Version footer ────────────────────────────────────
	const GITHUB_REPO = 'https://github.com/rustyguts/alcoves';
	const versionDisplay = $derived.by(() => {
		const sha = versionInfo?.commit;
		if (!sha) return null;
		return {
			short: sha.slice(0, 7),
			href: `${GITHUB_REPO}/commit/${sha}`,
			dirty: versionInfo?.dirty ?? false,
			buildTime: versionInfo?.buildTime || null
		};
	});

	// ─── Users ─────────────────────────────────────────────
	const roleOptions = [
		{ label: 'Owner', value: 'owner' },
		{ label: 'Member', value: 'member' }
	];

	let updatingRoleUserId = $state<string | null>(null);
	async function updateUserRole(user: AdminUser, nextRole: AdminUser['role']) {
		if (!nextRole || nextRole === user.role) return;
		// Same one-way `value` desync as the registration mode / model Selects
		// (F3): optimistically write the row's own `role` field (read directly
		// by this row's Select `value` prop) and revert it on failure — a real
		// value change, not a same-array-reference no-op — so the row re-syncs
		// to the server's actual role and a rejected pick can be retried.
		const previousRole = user.role;
		user.role = nextRole;
		updatingRoleUserId = user.id;
		try {
			const updated = await api.admin.updateUserRole(user.id, { role: nextRole });
			user.role = updated.role;
			toast.add({ title: 'Role updated', color: 'success' });
		} catch (error: unknown) {
			user.role = previousRole;
			toast.add({ title: errorMessage(error, 'Failed to update role'), color: 'error' });
		} finally {
			updatingRoleUserId = null;
		}
	}

	function formatDateTime(dateString: string | null): string {
		if (!dateString) return '—';
		return new Date(dateString).toLocaleString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	// ─── Stat cards ────────────────────────────────────────
	interface StatCard {
		key: string;
		title: string;
		value: string;
		caption: string;
		icon: string;
		color: string;
	}

	// Neutral, media-first chrome: alternate primary/neutral tints instead of a
	// rainbow per metric — success/warning/destructive stay reserved for actual
	// status signal elsewhere on this page (job states, load errors).
	const statCards = $derived<StatCard[]>([
		{
			key: 'files',
			title: 'Files',
			value: stats?.files?.toLocaleString('en-US') ?? '—',
			caption: 'Active across all libraries',
			icon: ICONS.files,
			color: 'text-primary bg-primary/10'
		},
		{
			key: 'storage',
			title: 'Storage',
			value: stats ? formatFileSize(stats.totalSize) : '—',
			caption: 'Total disk usage',
			icon: ICONS.storage,
			color: 'text-muted-foreground bg-muted'
		},
		{
			key: 'libraries',
			title: 'Libraries',
			value: stats?.libraries?.toLocaleString('en-US') ?? '—',
			caption: 'Including personal defaults',
			icon: ICONS.library,
			color: 'text-primary bg-primary/10'
		},
		{
			key: 'users',
			title: 'Users',
			value: stats?.users?.toLocaleString('en-US') ?? '—',
			caption: 'Registered accounts',
			icon: ICONS.members,
			color: 'text-muted-foreground bg-muted'
		},
		{
			key: 'folders',
			title: 'Folders',
			value: stats?.folders?.toLocaleString('en-US') ?? '—',
			caption: 'Active folder hierarchy',
			icon: ICONS.folder,
			color: 'text-primary bg-primary/10'
		}
	]);
</script>

<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-0.5">
	<PageHeader
		title="Admin Dashboard"
		description="Instance overview, user management, and background jobs."
	/>

	{#if statsError}
		<div
			class="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			<AppIcon name={ICONS.warning} class="size-5 shrink-0" />
			<span class="flex-1">Couldn't load instance statistics.</span>
			<Button variant="destructive" size="sm" onclick={loadStats}>Retry</Button>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
		{#each statCards as s (s.key)}
			<StatCard
				title={s.title}
				value={s.value}
				caption={s.caption}
				icon={s.icon}
				iconClass={s.color}
			/>
		{/each}
	</div>

	{#if settingsError}
		<div
			class="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			<AppIcon name={ICONS.warning} class="size-5 shrink-0" />
			<span class="flex-1">Couldn't load instance settings — values below may be inaccurate.</span>
			<Button variant="destructive" size="sm" onclick={loadSettings}>Retry</Button>
		</div>
	{/if}

	<AppPanel
		title="Registration"
		description="Control who can create accounts on this instance."
		icon={ICONS.person}
	>
		<RadioGroup.Root
			value={settings?.registration_mode ?? 'open'}
			onValueChange={(next) => updateRegistrationMode(next as RegistrationMode)}
			disabled={updatingRegistrationMode}
			class="flex flex-col gap-1"
		>
			{#each registrationModes as mode (mode.value)}
				{@const id = `registration-mode-${mode.value}`}
				<label
					for={id}
					class="flex cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-accent hover:text-accent-foreground"
				>
					<RadioGroup.Item {id} value={mode.value} class="mt-1" />
					<div class="min-w-0">
						<p class="text-sm font-medium">{mode.label}</p>
						<p class="text-xs text-muted-foreground">{mode.description}</p>
					</div>
				</label>
			{/each}
		</RadioGroup.Root>
	</AppPanel>

	<AppPanel
		title="Inference models"
		description="Switch the transcription model and audio-tagger used by background workers. Changes take effect on the next job; long-running jobs already in flight finish on the previous model."
		icon={ICONS.models}
	>
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<div class="flex flex-col gap-3">
				<div>
					<p class="text-sm font-medium">Transcription model (whisper.cpp)</p>
					<p class="text-xs text-muted-foreground">
						Lower WER = better accuracy. RAM peak is the inference high-water mark for whisper-cli;
						budget headroom for ffmpeg + the rest of the worker pod.
					</p>
				</div>
				<Select.Root
					type="single"
					value={whisperModel}
					onValueChange={(v) => updateWhisperModel(v)}
					disabled={updatingWhisper}
				>
					<Select.Trigger class="w-full" aria-label="Transcription model">
						{whisperModelLabel}
					</Select.Trigger>
					<Select.Content>
						{#each whisperModels as m (m.id)}
							<Select.Item value={m.id} label={m.label} />
						{/each}
					</Select.Content>
				</Select.Root>
				{#if selectedWhisper}
					<div class="flex flex-col gap-1.5 rounded-md bg-muted p-3 text-xs">
						<p>{selectedWhisper.notes}</p>
						<div class="grid grid-cols-2 gap-2 text-muted-foreground">
							<p>
								Disk: <span class="text-foreground">{formatMB(selectedWhisper.diskMB)}</span>
							</p>
							<p>
								RAM peak:
								<span class="text-foreground">{formatMB(selectedWhisper.ramPeakMB)}</span>
							</p>
							<p>
								CPU speed:
								<span class="text-foreground">~{selectedWhisper.realtime}× realtime</span>
							</p>
							<p>
								WER (clean/other):
								<span class="text-foreground"
									>{selectedWhisper.werClean.toFixed(1)}% / {selectedWhisper.werOther.toFixed(
										1
									)}%</span
								>
							</p>
							{#if selectedWhisper.english}
								<p class="col-span-2 text-warning">English-only</p>
							{/if}
							{#if selectedWhisper.ramPeakMB >= 3000}
								<p class="col-span-2 text-warning">⚠️ Needs ≥4 GB RAM in the worker pod.</p>
							{/if}
						</div>
					</div>
				{/if}
				<div class="pt-1">
					<p class="mb-1 text-xs text-muted-foreground">Language</p>
					<Select.Root
						type="single"
						value={whisperLanguage}
						onValueChange={(v) => updateWhisperLanguage(v)}
						disabled={updatingWhisper}
					>
						<Select.Trigger class="w-full" aria-label="Transcription language">
							{whisperLanguageLabel}
						</Select.Trigger>
						<Select.Content>
							{#each whisperLanguages as l (l.id)}
								<Select.Item value={l.id} label={l.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<div class="flex flex-col gap-3">
				<div>
					<p class="text-sm font-medium">Audio tagger (AudioSet 527 classes)</p>
					<p class="text-xs text-muted-foreground">
						Powers the per-clip event labels (music, speech, applause, …). Higher mAP = better
						tagging quality. Every model shares the same 527-class label space, so existing
						HighlightFilter expressions keep working after a swap.
					</p>
				</div>
				<Select.Root
					type="single"
					value={audioTagger}
					onValueChange={(v) => updateAudioTagger(v)}
					disabled={updatingAudioTagger}
				>
					<Select.Trigger class="w-full" aria-label="Audio tagger">
						{audioTaggerLabel}
					</Select.Trigger>
					<Select.Content>
						{#each audioTaggers as m (m.id)}
							<Select.Item
								value={m.id}
								label={m.available ? m.label : `${m.label} — not yet available`}
								disabled={!m.available}
							/>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if selectedAudioTagger}
					<div class="flex flex-col gap-1.5 rounded-md bg-muted p-3 text-xs">
						<p>{selectedAudioTagger.notes}</p>
						<div class="grid grid-cols-2 gap-2 text-muted-foreground">
							<p>
								Disk:
								<span class="text-foreground">{formatMB(selectedAudioTagger.diskMB)}</span>
							</p>
							<p>
								RAM peak:
								<span class="text-foreground">{formatMB(selectedAudioTagger.ramPeakMB)}</span>
							</p>
							<p>
								mAP (AudioSet):
								<span class="text-foreground">{selectedAudioTagger.mAP.toFixed(3)}</span>
							</p>
							<p>License: <span class="text-foreground">{selectedAudioTagger.license}</span></p>
						</div>
					</div>
				{/if}
				<p class="text-xs text-muted-foreground">
					New tagger applies to <em>future</em> detection jobs. Re-run via the bulk action on a library's
					settings page to backfill existing files with the new model.
				</p>
			</div>
		</div>
	</AppPanel>

	<AppPanel title="Users" description="Manage accounts and roles." icon={ICONS.members} flush>
		{#snippet actions()}
			{#if users}
				<Badge variant="secondary">{users.length}</Badge>
			{/if}
		{/snippet}

		{#if usersStatus === 'pending'}
			<div class="flex flex-col gap-2 p-4">
				{#each Array(4) as _, i (i)}
					<Skeleton class="h-12 w-full" />
				{/each}
			</div>
		{:else if users?.length}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>User</Table.Head>
						<Table.Head>Role</Table.Head>
						<Table.Head>Joined</Table.Head>
						<Table.Head>Updated</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each users as user (user.id)}
						<Table.Row>
							<Table.Cell class="whitespace-normal">
								<div class="flex items-center gap-3">
									<UserAvatar
										displayName={user.displayName}
										avatarUrl={user.avatarUrl}
										sizeClass="w-8"
									/>
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">{user.displayName}</p>
										<p class="truncate text-xs text-muted-foreground">{user.email}</p>
									</div>
								</div>
							</Table.Cell>
							<Table.Cell>
								<Select.Root
									type="single"
									value={user.role}
									onValueChange={(v) => updateUserRole(user, v as AdminUser['role'])}
									disabled={updatingRoleUserId === user.id || currentUser?.id === user.id}
								>
									<Select.Trigger class="w-28" aria-label={`Change role for ${user.displayName}`}>
										{roleOptions.find((o) => o.value === user.role)?.label ?? user.role}
									</Select.Trigger>
									<Select.Content>
										{#each roleOptions as opt (opt.value)}
											<Select.Item value={opt.value} label={opt.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground">
								{formatDateTime(user.createdAt)}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground">
								{formatDateTime(user.updatedAt)}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{:else if usersStatus === 'error'}
			<EmptyState
				icon={ICONS.warning}
				title="Couldn't load users"
				description="Something went wrong fetching the user list. Try again."
				tone="error"
			>
				{#snippet actions()}
					<Button variant="secondary" onclick={loadUsers}>
						<AppIcon name={ICONS.reload} class="size-4" />
						Retry
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState icon={ICONS.members} title="No users found" />
		{/if}
	</AppPanel>

	<AdminJobsPanel embedded />

	{#if versionDisplay}
		<footer class="flex items-center justify-end gap-2 pt-2 pb-4 text-xs text-muted-foreground">
			<span>Version</span>
			<a
				href={versionDisplay.href}
				target="_blank"
				rel="noopener noreferrer"
				class="font-mono underline hover:text-foreground"
			>
				{versionDisplay.short}
			</a>
			{#if versionDisplay.dirty}
				<Badge class="bg-warning/10 text-xs text-warning">dirty</Badge>
			{/if}
			{#if versionDisplay.buildTime}
				<span class="text-muted-foreground/70"
					>· built {formatDateTime(versionDisplay.buildTime)}</span
				>
			{/if}
		</footer>
	{/if}
</div>
