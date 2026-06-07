<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { api } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import { createLibraryMembers } from '$lib/state/library-members.svelte';
	import { canManageLibrary } from '$lib/utils/permissions';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import AppPanelRow from '$lib/components/ui/AppPanelRow.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import EmojiPicker from '$lib/components/ui/EmojiPicker.svelte';
	import AppModal from '$lib/components/ui/AppModal.svelte';
	import SettingsSection from '$lib/components/library/settings/SettingsSection.svelte';
	import InviteLinkRow from '$lib/components/library/settings/InviteLinkRow.svelte';
	import LibraryMemberRow from '$lib/components/library/settings/LibraryMemberRow.svelte';
	import type { Library, LibraryUsersResponse } from '$lib/types/api';
	import type { PageProps } from './$types';

	/**
	 * Library settings — name/emoji, AI feature toggles (face/object/sharing),
	 * members + invite links, reprocess actions, and the danger-zone delete.
	 * Ported faithfully from the Nuxt `pages/libraries/[id]/settings.vue`.
	 *
	 * `data.library` and `data.user` come from the authed/subtree layout loads, so
	 * we read those from props and only fetch the mutable bits client-side: a fresh
	 * library copy (so toggles reflect immediately) and the users response (members
	 * + invite links). `refreshLibrary()` re-fetches the library; `invalidateAll()`
	 * re-runs the layout loads so the sidebar/header pick up name/emoji changes.
	 */
	let { data }: PageProps = $props();

	const libraryId = $derived(page.params.id ?? '');

	// Local mirror of the library: prefer the freshly-fetched copy (so feature
	// switches reflect the latest server state after a mutation), falling back to
	// the layout-loaded library for the initial render.
	let freshLibrary = $state<Library | null>(null);
	const library = $derived<Library | null>(freshLibrary ?? data.library ?? null);
	let libraryUsers = $state<LibraryUsersResponse | null>(null);

	async function refreshLibrary() {
		freshLibrary = await api.libraries.get(libraryId);
	}

	async function refreshLibraryUsers() {
		libraryUsers = await api.members.list(libraryId);
	}

	const members = createLibraryMembers(
		() => libraryId,
		() => libraryUsers,
		refreshLibraryUsers
	);

	// Keep the role drafts reconciled with the members list whenever it changes.
	$effect(() => {
		// Re-run only when the member list changes. syncDrafts() writes
		// `memberRoleDrafts` (which it also reads, to preserve in-flight edits), so
		// it MUST run untracked — otherwise the effect tracks that write and
		// re-triggers itself forever (effect_update_depth_exceeded), which silently
		// breaks reactivity for the whole page (the mobile sidebar wouldn't open).
		void members.libraryMembers;
		untrack(() => members.syncDrafts());
	});

	let newLinkMaxUses = $state('');
	let newLinkExpiresAt = $state('');

	async function submitCreateInviteLink() {
		// `newLinkMaxUses` is bound to a `type="number"` input, so Svelte coerces it
		// to a number once the user types — stringify before trimming so we don't
		// call `.trim()` on a number (which throws and aborts link creation).
		const max = String(newLinkMaxUses ?? '').trim();
		const exp = String(newLinkExpiresAt ?? '').trim();
		await members.createInviteLink({
			maxUses: max ? Number(max) : null,
			expiresAt: exp ? new Date(exp).toISOString() : null
		});
		newLinkMaxUses = '';
		newLinkExpiresAt = '';
	}

	let fileCounts = $state<{ totalCount: number; trashedCount: number } | null>(null);

	async function fetchFileCounts() {
		try {
			const [activeFiles, trashedFiles] = await Promise.all([
				api.files.list(libraryId, { limit: '1' }),
				api.files.list(libraryId, { trashed: 'true', limit: '1' })
			]);
			fileCounts = {
				totalCount: activeFiles.totalCount ?? 0,
				trashedCount: trashedFiles.totalCount ?? 0
			};
		} catch {
			// Ignore errors — the delete button just stays disabled.
		}
	}

	async function refreshFileCounts() {
		await fetchFileCounts();
	}

	const isLibraryManager = $derived(canManageLibrary(library, data.user));

	const isLibraryOwner = $derived(
		!!library?.ownerId && !!data.user?.id && library.ownerId === data.user.id
	);

	// Non-managers shouldn't be on this page — bounce them back to the library.
	$effect(() => {
		if (library && !isLibraryManager) {
			goto(`/libraries/${libraryId}`);
		}
	});

	async function saveLibraryEmoji(emoji: string | null) {
		await api.libraries.update(libraryId, { emoji: emoji ?? '' });
		await refreshLibrary();
		await invalidateAll();
	}

	// ─── Library name ───────────────────────────────────────
	let savingLibraryName = $state(false);
	let libraryNameDraft = $state('');

	// Seed the draft from the library name whenever it changes.
	let lastSeededName = $state<string | null>(null);
	$effect(() => {
		const name = library?.name ?? '';
		if (name !== lastSeededName) {
			libraryNameDraft = name;
			lastSeededName = name;
		}
	});

	const canSaveName = $derived(
		!savingLibraryName &&
			!!libraryNameDraft.trim() &&
			libraryNameDraft.trim() !== (library?.name ?? '')
	);

	async function saveLibraryNameFromSettings() {
		const trimmed = libraryNameDraft.trim();
		if (!trimmed || trimmed === library?.name) return;

		savingLibraryName = true;
		try {
			await api.libraries.update(libraryId, { name: trimmed });
			await refreshLibrary();
			await invalidateAll();
			toast.add({ title: 'Library name updated', color: 'success' });
		} catch {
			toast.add({ title: 'Failed to update library name', color: 'error' });
		} finally {
			savingLibraryName = false;
		}
	}

	// ─── Facial recognition ─────────────────────────────────
	let faceRecToggling = $state(false);
	let faceRecDisableOpen = $state(false);
	let faceRecReprocessOpen = $state(false);
	let faceRecReprocessing = $state(false);

	async function toggleFaceRecognition(enabled: boolean) {
		if (!enabled) {
			faceRecDisableOpen = true;
			return;
		}
		faceRecToggling = true;
		try {
			await api.libraries.update(libraryId, { faceRecognitionEnabled: true });
			await refreshLibrary();
			toast.add({ title: 'Face recognition enabled. Processing will begin shortly.' });
		} catch {
			toast.add({ title: 'Failed to enable face recognition', color: 'error' });
		} finally {
			faceRecToggling = false;
		}
	}

	async function confirmDisableFaceRecognition() {
		faceRecToggling = true;
		faceRecDisableOpen = false;
		try {
			await api.libraries.update(libraryId, { faceRecognitionEnabled: false });
			await refreshLibrary();
			toast.add({ title: 'Face recognition disabled. All face data has been deleted.' });
		} catch {
			toast.add({ title: 'Failed to disable face recognition', color: 'error' });
		} finally {
			faceRecToggling = false;
		}
	}

	async function reprocessFaceRecognition() {
		faceRecReprocessing = true;
		faceRecReprocessOpen = false;
		try {
			const result = await api.people.reprocess(libraryId);
			toast.add({
				title: 'Reprocessing queued',
				description: `${result.queuedCount} image${result.queuedCount === 1 ? '' : 's'} queued for fresh facial recognition.`
			});
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Failed to queue facial recognition reprocessing';
			toast.add({ title: message, color: 'error' });
		} finally {
			faceRecReprocessing = false;
		}
	}

	// ─── Object detection ───────────────────────────────────
	let objDetToggling = $state(false);
	let objDetDisableOpen = $state(false);
	let objDetReprocessOpen = $state(false);
	let objDetReprocessing = $state(false);

	async function toggleObjectDetection(enabled: boolean) {
		if (!enabled) {
			objDetDisableOpen = true;
			return;
		}
		objDetToggling = true;
		try {
			await api.libraries.update(libraryId, { objectDetectionEnabled: true });
			await refreshLibrary();
			toast.add({ title: 'Object detection enabled. Processing will begin shortly.' });
		} catch {
			toast.add({ title: 'Failed to enable object detection', color: 'error' });
		} finally {
			objDetToggling = false;
		}
	}

	async function confirmDisableObjectDetection() {
		objDetToggling = true;
		objDetDisableOpen = false;
		try {
			await api.libraries.update(libraryId, { objectDetectionEnabled: false });
			await refreshLibrary();
			toast.add({ title: 'Object detection disabled. All detection data has been deleted.' });
		} catch {
			toast.add({ title: 'Failed to disable object detection', color: 'error' });
		} finally {
			objDetToggling = false;
		}
	}

	async function reprocessObjectDetection() {
		objDetReprocessing = true;
		objDetReprocessOpen = false;
		try {
			const result = await api.objects.reprocess(libraryId);
			toast.add({
				title: 'Reprocessing queued',
				description: `${result.queuedCount} image${result.queuedCount === 1 ? '' : 's'} queued for fresh object detection.`
			});
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Failed to queue object detection reprocessing';
			toast.add({ title: message, color: 'error' });
		} finally {
			objDetReprocessing = false;
		}
	}

	// ─── Transcription ──────────────────────────────────────
	let transcribeReprocessOpen = $state(false);
	let transcribeReprocessing = $state(false);

	// Reprocess every video/audio file in the library. Asynq dedup on the enqueue
	// side prevents duplicate worker runs if the user clicks twice.
	async function reprocessTranscripts() {
		transcribeReprocessing = true;
		transcribeReprocessOpen = false;
		try {
			const result = await api.files.bulkTranscribe(libraryId);
			const skippedCount = Object.keys(result.skipped).length;
			toast.add({
				title: 'Transcription queued',
				description: `${result.enqueued.length} file${result.enqueued.length === 1 ? '' : 's'} queued${skippedCount ? `, ${skippedCount} skipped` : ''}.`
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to queue bulk transcription';
			toast.add({ title: message, color: 'error' });
		} finally {
			transcribeReprocessing = false;
		}
	}

	// ─── Audio event detection ──────────────────────────────
	let audioDetectReprocessOpen = $state(false);
	let audioDetectReprocessing = $state(false);

	async function reprocessAudioDetections() {
		audioDetectReprocessing = true;
		audioDetectReprocessOpen = false;
		try {
			const result = await api.files.bulkAudioDetect(libraryId);
			const skippedCount = Object.keys(result.skipped).length;
			toast.add({
				title: 'Audio detection queued',
				description: `${result.enqueued.length} file${result.enqueued.length === 1 ? '' : 's'} queued${skippedCount ? `, ${skippedCount} skipped` : ''}.`
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to queue bulk audio detection';
			toast.add({ title: message, color: 'error' });
		} finally {
			audioDetectReprocessing = false;
		}
	}

	// ─── Sharing ────────────────────────────────────────────
	let sharingToggling = $state(false);

	async function toggleSharing(enabled: boolean) {
		sharingToggling = true;
		try {
			await api.libraries.update(libraryId, { sharingEnabled: enabled });
			await refreshLibrary();
			toast.add({
				title: enabled
					? 'Sharing enabled. Members can now create public share links.'
					: 'Sharing disabled. Existing links are revoked.',
				color: 'success'
			});
		} catch {
			toast.add({ title: 'Failed to update sharing setting', color: 'error' });
		} finally {
			sharingToggling = false;
		}
	}

	// ─── Video thumbnails ───────────────────────────────────
	let videoThumbReprocessOpen = $state(false);
	let videoThumbReprocessing = $state(false);

	async function reprocessVideoThumbnails() {
		videoThumbReprocessing = true;
		videoThumbReprocessOpen = false;
		try {
			const result = await api.files.reprocessVideoThumbnails(libraryId);
			toast.add({
				title: 'Thumbnail regeneration queued',
				description: `${result.queuedCount} video${result.queuedCount === 1 ? '' : 's'} queued for thumbnail regeneration.`
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to queue thumbnail regeneration';
			toast.add({ title: message, color: 'error' });
		} finally {
			videoThumbReprocessing = false;
		}
	}

	// ─── Photo metadata ─────────────────────────────────────
	let metadataReprocessOpen = $state(false);
	let metadataReprocessing = $state(false);

	async function reprocessMetadata() {
		metadataReprocessing = true;
		metadataReprocessOpen = false;
		try {
			const result = await api.libraries.metadataReprocess(libraryId);
			toast.add({
				title: 'Metadata reprocessing queued',
				description: `${result.queuedCount} file${result.queuedCount === 1 ? '' : 's'} queued for capture-date & GPS extraction.`
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to queue metadata reprocessing';
			toast.add({ title: message, color: 'error' });
		} finally {
			metadataReprocessing = false;
		}
	}

	// ─── Danger zone ────────────────────────────────────────
	let deleteLibraryOpen = $state(false);
	let deleteLibraryConfirmation = $state('');

	const canDeleteLibrary = $derived.by(() => {
		if (!library || !data.user) return false;
		if (library.isDefault) return false;
		if (library.ownerId !== data.user.id) return false;
		if ((fileCounts?.totalCount ?? 0) > 0 || (fileCounts?.trashedCount ?? 0) > 0) {
			return false;
		}
		return true;
	});

	async function deleteLibrary() {
		try {
			await api.libraries.delete(libraryId);
			deleteLibraryOpen = false;
			await invalidateAll();
			goto('/');
		} catch {
			toast.add({
				title: 'Failed to delete library',
				description: 'Library must be empty before it can be deleted.',
				color: 'error'
			});
			await refreshFileCounts();
		}
	}

	onMount(async () => {
		await Promise.all([refreshLibrary(), refreshLibraryUsers(), fetchFileCounts()]);
	});
</script>

<div class="min-h-0 w-full flex-1 overflow-y-auto px-0.5">
	<div class="divide-y divide-surface-200-800">
		<!-- Library Name -->
		<SettingsSection
			title="Library Name"
			description="Rename this library and pick an emoji. The emoji saves as soon as you choose it."
			icon={ICONS.folder}
		>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<EmojiPicker value={library?.emoji ?? null} onselect={saveLibraryEmoji} />
				<input
					bind:value={libraryNameDraft}
					placeholder="Library name"
					class="input sm:flex-1"
					onkeydown={(e) => {
						if (e.key === 'Enter') saveLibraryNameFromSettings();
					}}
				/>
				<button
					type="button"
					class="btn preset-tonal-primary"
					disabled={!canSaveName}
					onclick={saveLibraryNameFromSettings}
				>
					{#if savingLibraryName}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.check} class="size-4" />
					{/if}
					Save
				</button>
			</div>
		</SettingsSection>

		<!-- Library Members -->
		{#if !library?.isDefault}
			<SettingsSection
				title="Library Members"
				description="Manage who has access to this library and their permissions."
				icon={ICONS.members}
			>
				<div class="space-y-6">
					<div class="space-y-3">
						<div>
							<p class="text-sm font-medium">Create Invite Link</p>
							<p class="text-xs text-surface-600-400">
								Anyone with the link can sign up and join this library as a member.
							</p>
						</div>
						<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
							<label class="flex-1">
								<span class="mb-1 block text-xs font-medium">Max uses</span>
								<input
									bind:value={newLinkMaxUses}
									type="number"
									min="1"
									placeholder="Unlimited"
									class="input w-full"
								/>
							</label>
							<label class="flex-1">
								<span class="mb-1 block text-xs font-medium">Expires at</span>
								<input bind:value={newLinkExpiresAt} type="datetime-local" class="input w-full" />
							</label>
							<button
								type="button"
								class="btn preset-filled-primary-500"
								disabled={members.createInviteLinkLoading}
								onclick={submitCreateInviteLink}
							>
								{#if members.createInviteLinkLoading}
									<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
								{:else}
									<AppIcon name={ICONS.link} class="size-4" />
								{/if}
								Create Link
							</button>
						</div>
						<p class="text-xs text-surface-600-400">
							Leave both fields blank for unlimited uses that never expire.
						</p>
					</div>

					{#if members.inviteLinks.length}
						<hr class="hr" />
						<div class="space-y-3">
							<div class="flex items-center justify-between gap-3">
								<div>
									<p class="text-sm font-medium">Active Invite Links</p>
									<p class="text-xs text-surface-600-400">
										Track redemptions and revoke links you no longer need.
									</p>
								</div>
								<span class="badge preset-tonal-surface">{members.inviteLinks.length}</span>
							</div>
							<div class="divide-y divide-surface-200-800 border-y border-surface-200-800">
								{#each members.inviteLinks as invite (invite.id)}
									<InviteLinkRow
										{invite}
										revoking={members.revokingInviteId === invite.id}
										oncopy={members.copyInviteLink}
										onrevoke={members.revokeInvite}
									/>
								{/each}
							</div>
						</div>
					{/if}

					{#if members.libraryMembers.length}
						<hr class="hr" />
						<div class="space-y-3">
							<p class="text-sm font-medium">Members</p>
							<div class="divide-y divide-surface-200-800 border-y border-surface-200-800">
								{#each members.libraryMembers as member (member.id)}
									<LibraryMemberRow
										{member}
										roleDraft={members.memberRoleDrafts[member.userId] ??
											(member.role === 'owner' ? 'admin' : member.role)}
										updatingRole={members.updatingMemberUserId === member.userId}
										removing={members.removingMemberUserId === member.userId}
										roleOptions={members.inviteRoleOptions}
										onupdateRole={(_, role) => {
											members.memberRoleDrafts[member.userId] = role;
											members.updateMemberRole(member);
										}}
										onremove={members.removeMember}
									/>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</SettingsSection>
		{/if}

		<!-- Facial Recognition -->
		<SettingsSection
			title="Facial Recognition"
			description="Detect and group faces from image uploads. Disabling removes all face data."
			icon={ICONS.people}
		>
			<div class="space-y-4">
				<AppPanelRow
					title="Enable facial recognition"
					description="Process new uploads and group detected faces."
				>
					<Switch
						checked={library?.faceRecognitionEnabled ?? false}
						disabled={faceRecToggling}
						onCheckedChange={(e) => toggleFaceRecognition(e.checked)}
					>
						<Switch.Control>
							<Switch.Thumb />
						</Switch.Control>
					</Switch>
				</AppPanelRow>

				<hr class="hr" />

				<AppPanelRow
					title="Queue full reprocessing"
					description="Deletes current face inference data, then re-runs detection on all images."
				>
					<button
						type="button"
						class="btn preset-tonal-warning"
						disabled={!library?.faceRecognitionEnabled || faceRecToggling || faceRecReprocessing}
						onclick={() => (faceRecReprocessOpen = true)}
					>
						{#if faceRecReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.reload} class="size-4" />
						{/if}
						Reprocess Faces
					</button>
				</AppPanelRow>
			</div>
		</SettingsSection>

		<!-- Object Detection -->
		<SettingsSection
			title="Object Detection"
			description="Detect objects in image uploads using YOLO26. Disabling removes all detection data."
			icon={ICONS.objectDetection}
		>
			<div class="space-y-4">
				<AppPanelRow
					title="Enable object detection"
					description="Process new uploads and index detected objects."
				>
					<Switch
						checked={library?.objectDetectionEnabled ?? false}
						disabled={objDetToggling}
						onCheckedChange={(e) => toggleObjectDetection(e.checked)}
					>
						<Switch.Control>
							<Switch.Thumb />
						</Switch.Control>
					</Switch>
				</AppPanelRow>

				<hr class="hr" />

				<AppPanelRow
					title="Browse detected objects"
					description="View detected object labels and their frequency across the library."
				>
					<a
						class="btn preset-tonal-surface"
						class:pointer-events-none={!library?.objectDetectionEnabled}
						class:opacity-50={!library?.objectDetectionEnabled}
						aria-disabled={!library?.objectDetectionEnabled}
						href={`/libraries/${libraryId}/objects`}
					>
						<AppIcon name={ICONS.objectDetection} class="size-4" />
						View Objects
					</a>
				</AppPanelRow>

				<hr class="hr" />

				<AppPanelRow
					title="Queue full reprocessing"
					description="Deletes current object detection data, then re-runs detection on all images."
				>
					<button
						type="button"
						class="btn preset-tonal-warning"
						disabled={!library?.objectDetectionEnabled || objDetToggling || objDetReprocessing}
						onclick={() => (objDetReprocessOpen = true)}
					>
						{#if objDetReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.reload} class="size-4" />
						{/if}
						Reprocess Objects
					</button>
				</AppPanelRow>
			</div>
		</SettingsSection>

		<!-- Transcription -->
		<SettingsSection
			title="Transcription"
			description="Generate searchable text + WebVTT cues from video and audio files using whisper.cpp."
			icon={ICONS.transcript}
		>
			<AppPanelRow
				title="Re-transcribe all videos"
				description="Queues transcription for every video and audio file in this library, overwriting existing transcripts. Useful after a model upgrade or hallucination-fix rollout."
			>
				<button
					type="button"
					class="btn preset-tonal-warning"
					disabled={transcribeReprocessing}
					onclick={() => (transcribeReprocessOpen = true)}
				>
					{#if transcribeReprocessing}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.transcript} class="size-4" />
					{/if}
					Reprocess Transcripts
				</button>
			</AppPanelRow>
		</SettingsSection>

		<!-- Audio Event Detection -->
		<SettingsSection
			title="Audio Event Detection"
			description="Tag audio segments with PANNs CNN14 (music, speech, applause, …). Requires the file's transcript to be ready."
			icon={ICONS.audioDetect}
		>
			<AppPanelRow
				title="Re-run audio detection on all videos"
				description="Queues PANNs detection for every video and audio file with a ready transcript, overwriting existing audio-event tags."
			>
				<button
					type="button"
					class="btn preset-tonal-warning"
					disabled={audioDetectReprocessing}
					onclick={() => (audioDetectReprocessOpen = true)}
				>
					{#if audioDetectReprocessing}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.audioDetect} class="size-4" />
					{/if}
					Reprocess Audio Detections
				</button>
			</AppPanelRow>
		</SettingsSection>

		<!-- Sharing -->
		<SettingsSection
			title="Sharing"
			description="Allow members to create public share links for moments in this library."
			icon={ICONS.share}
		>
			<AppPanelRow
				title="Enable sharing"
				description="When on, anyone with a share link can view the individual moment without signing in."
			>
				<Switch
					checked={library?.sharingEnabled ?? false}
					disabled={sharingToggling}
					onCheckedChange={(e) => toggleSharing(e.checked)}
				>
					<Switch.Control>
						<Switch.Thumb />
					</Switch.Control>
				</Switch>
			</AppPanelRow>
		</SettingsSection>

		<!-- Video Thumbnails -->
		{#if isLibraryOwner}
			<SettingsSection
				title="Video Thumbnails"
				description="Regenerate JPG thumbnails for all source videos in this library."
				icon={ICONS.image}
			>
				<div class="flex sm:justify-end">
					<button
						type="button"
						class="btn preset-tonal-warning"
						disabled={videoThumbReprocessing}
						onclick={() => (videoThumbReprocessOpen = true)}
					>
						{#if videoThumbReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.image} class="size-4" />
						{/if}
						Regenerate Thumbnails
					</button>
				</div>
			</SettingsSection>
		{/if}

		<!-- Photo Metadata (Timeline + Map) -->
		{#if isLibraryOwner}
			<SettingsSection
				title="Photo Metadata"
				description="Re-extract capture date & GPS location (EXIF) for all photos and videos. Powers the Timeline and Map views."
				icon={ICONS.location}
			>
				<div class="flex sm:justify-end">
					<button
						type="button"
						class="btn preset-tonal-warning"
						disabled={metadataReprocessing}
						onclick={() => (metadataReprocessOpen = true)}
					>
						{#if metadataReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.reload} class="size-4" />
						{/if}
						Reprocess Metadata
					</button>
				</div>
			</SettingsSection>
		{/if}

		<!-- Danger Zone -->
		<SettingsSection>
			{#snippet title_()}
				<div class="flex items-center gap-2">
					<AppIcon name={ICONS.warning} class="size-4 shrink-0 text-error-500" />
					<h2 class="text-sm font-semibold text-error-500">Delete Library</h2>
				</div>
			{/snippet}
			<AppPanelRow
				title="Delete this library"
				description="Permanently remove this library. Must be empty first."
				danger
			>
				<button
					type="button"
					class="btn preset-tonal-error"
					disabled={!canDeleteLibrary}
					onclick={() => (deleteLibraryOpen = true)}
				>
					<AppIcon name={ICONS.trash} class="size-4" />
					Delete
				</button>
			</AppPanelRow>
		</SettingsSection>
	</div>

	<ConfirmModal
		bind:open={faceRecDisableOpen}
		title="Disable Facial Recognition"
		message="This will permanently delete all detected faces and people data for this library. This action cannot be undone."
		confirmLabel="Disable & Delete Data"
		confirmClass="btn-soft btn-error"
		confirmIcon={ICONS.trash}
		pending={faceRecToggling}
		onconfirm={confirmDisableFaceRecognition}
	/>

	<ConfirmModal
		bind:open={metadataReprocessOpen}
		title="Reprocess Photo Metadata"
		message="This re-extracts capture date and GPS location for every photo and video in the library, refreshing the Timeline and Map. Existing metadata is overwritten as each file completes."
		confirmLabel="Queue Reprocessing"
		confirmClass="btn-soft btn-warning"
		confirmIcon={ICONS.reload}
		pending={metadataReprocessing}
		onconfirm={reprocessMetadata}
	/>

	<ConfirmModal
		bind:open={videoThumbReprocessOpen}
		title="Regenerate Video Thumbnails"
		message="This queues thumbnail regeneration for all source videos in this library. Existing generated thumbnails will be replaced as new ones complete."
		confirmLabel="Queue Regeneration"
		confirmClass="btn-soft btn-warning"
		confirmIcon={ICONS.image}
		pending={videoThumbReprocessing}
		onconfirm={reprocessVideoThumbnails}
	/>

	<ConfirmModal
		bind:open={faceRecReprocessOpen}
		title="Reprocess Facial Recognition"
		message="This deletes all existing face inference data and queues a full rebuild. Results may change, including how photos are grouped into people."
		confirmLabel="Delete Data & Requeue"
		confirmClass="btn-soft btn-warning"
		confirmIcon={ICONS.reload}
		pending={faceRecReprocessing}
		onconfirm={reprocessFaceRecognition}
	/>

	<ConfirmModal
		bind:open={transcribeReprocessOpen}
		title="Reprocess Transcripts"
		message="This queues transcription for every video and audio file in the library. Existing transcripts will be overwritten when each job completes."
		confirmLabel="Queue Reprocessing"
		confirmClass="btn-soft btn-warning"
		confirmIcon={ICONS.transcript}
		pending={transcribeReprocessing}
		onconfirm={reprocessTranscripts}
	/>

	<ConfirmModal
		bind:open={audioDetectReprocessOpen}
		title="Reprocess Audio Detections"
		message="This queues PANNs audio-event detection for every video and audio file with a ready transcript. Existing audio-event tags will be overwritten when each job completes."
		confirmLabel="Queue Reprocessing"
		confirmClass="btn-soft btn-warning"
		confirmIcon={ICONS.audioDetect}
		pending={audioDetectReprocessing}
		onconfirm={reprocessAudioDetections}
	/>

	<!-- Disable Object Detection Modal -->
	<AppModal
		bind:open={objDetDisableOpen}
		title="Disable Object Detection"
		description="This will permanently delete all detected object data for this library. This action cannot be undone."
	>
		<div class="flex w-full justify-end gap-2">
			<button
				type="button"
				class="btn preset-tonal-surface"
				disabled={objDetToggling}
				onclick={() => (objDetDisableOpen = false)}
			>
				Cancel
			</button>
			<button
				type="button"
				class="btn preset-filled-error-500"
				disabled={objDetToggling}
				onclick={confirmDisableObjectDetection}
			>
				{#if objDetToggling}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.trash} class="size-4" />
				{/if}
				Disable & Delete Data
			</button>
		</div>
	</AppModal>

	<!-- Reprocess Object Detection Modal -->
	<AppModal
		bind:open={objDetReprocessOpen}
		title="Reprocess Object Detection"
		description="This deletes all existing object detection data and queues a full rebuild. Detected objects may change if the model or settings have been updated."
	>
		<div class="flex w-full justify-end gap-2">
			<button
				type="button"
				class="btn preset-tonal-surface"
				disabled={objDetReprocessing}
				onclick={() => (objDetReprocessOpen = false)}
			>
				Cancel
			</button>
			<button
				type="button"
				class="btn preset-filled-warning-500"
				disabled={objDetReprocessing}
				onclick={reprocessObjectDetection}
			>
				{#if objDetReprocessing}
					<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
				{:else}
					<AppIcon name={ICONS.reload} class="size-4" />
				{/if}
				Delete Data & Requeue
			</button>
		</div>
	</AppModal>

	<!-- Delete Library Modal -->
	<AppModal
		bind:open={deleteLibraryOpen}
		title="Delete Library"
		description={`This will permanently delete the library ${library?.name ?? ''}. This action cannot be undone.`}
	>
		<div class="flex flex-col gap-2">
			<label class="text-sm font-medium" for="delete-library-confirm">
				Type 'delete' to confirm
			</label>
			<input
				id="delete-library-confirm"
				bind:value={deleteLibraryConfirmation}
				placeholder="delete"
				class="input w-full"
			/>
		</div>

		<div class="flex w-full justify-end gap-2">
			<button
				type="button"
				class="btn preset-tonal-surface"
				onclick={() => (deleteLibraryOpen = false)}
			>
				Cancel
			</button>
			<button
				type="button"
				class="btn preset-tonal-error"
				disabled={deleteLibraryConfirmation !== 'delete'}
				onclick={deleteLibrary}
			>
				<AppIcon name={ICONS.trash} class="size-4" />
				Delete Library
			</button>
		</div>
	</AppModal>
</div>
