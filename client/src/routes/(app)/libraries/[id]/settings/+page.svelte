<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/state/toast';
	import { createLibraryMembers } from '$lib/state/library-members.svelte';
	import { canManageLibrary } from '$lib/utils/permissions';
	import { ICONS } from '$lib/utils/icons';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
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

	// Writable $derived mirror of the switch's checked state, `bind:checked`
	// to the Switch below. A one-way `checked={library?.faceRecognitionEnabled}`
	// prop was tried first, but bits-ui's internal $bindable override for an
	// unbound `checked` prop does not reliably clear just because the
	// upstream value's reactive dependencies invalidate — the switch could
	// get stuck showing a stale value after the ConfirmModal was cancelled
	// or an update failed (F2, shadcn-rewrite rework findings; verified
	// empirically in browser-mode vitest — the one-way prop never resynced
	// even across multiple genuinely-distinct `library` object references).
	// Binding directly to a writable $derived sidesteps that: bits-ui's
	// writes land here directly, and every `refreshLibrary()` call
	// (success, cancel, or failure — see the catch blocks + ConfirmModal
	// `oncancel` below) reassigns `freshLibrary` to a new object, which
	// recomputes this derived and discards any local override.
	let faceRecChecked = $derived(library?.faceRecognitionEnabled ?? false);

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
			// faceRecChecked already flipped on optimistically via bind:checked —
			// resync from the server so the writable-$derived override above is
			// discarded and it snaps back to reflect the true server state.
			await refreshLibrary();
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
			// The disable never took effect server-side — resync so the switch
			// snaps back to "on" instead of showing the rejected "off" state.
			await refreshLibrary();
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

	// Same F2 fix as facial recognition above: writable $derived, bound via
	// bind:checked, rather than a one-way prop.
	let objDetChecked = $derived(library?.objectDetectionEnabled ?? false);

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
			// Resync from the server so the switch snaps back off (see
			// toggleFaceRecognition's catch for the same fix).
			await refreshLibrary();
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
			// The disable never took effect server-side — resync so the switch
			// snaps back to "on".
			await refreshLibrary();
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

	// Same F2 fix as facial recognition above: writable $derived, bound via
	// bind:checked, rather than a one-way prop.
	let sharingChecked = $derived(library?.sharingEnabled ?? false);

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
			// The switch already flipped optimistically — resync from the server
			// so it snaps back to reflect the state the server rejected.
			await refreshLibrary();
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
	<div class="flex flex-col gap-6 pb-6">
		<!-- Library Name -->
		<SettingsSection
			title="Library Name"
			description="Rename this library and pick an emoji. The emoji saves as soon as you choose it."
			icon={ICONS.folder}
		>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<EmojiPicker value={library?.emoji ?? null} onselect={saveLibraryEmoji} />
				<Input
					aria-label="Library name"
					bind:value={libraryNameDraft}
					placeholder="Library name"
					class="sm:flex-1"
					onkeydown={(e) => {
						if (e.key === 'Enter') saveLibraryNameFromSettings();
					}}
				/>
				<Button disabled={!canSaveName} onclick={saveLibraryNameFromSettings}>
					{#if savingLibraryName}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.check} class="size-4" />
					{/if}
					Save
				</Button>
			</div>
		</SettingsSection>

		<!-- Library Members -->
		{#if !library?.isDefault}
			<SettingsSection
				title="Library Members"
				description="Manage who has access to this library and their permissions."
				icon={ICONS.members}
			>
				<div class="flex flex-col gap-6">
					<div class="flex flex-col gap-3">
						<div>
							<p class="text-sm font-medium">Create Invite Link</p>
							<p class="text-xs text-muted-foreground">
								Anyone with the link can sign up and join this library as a member.
							</p>
						</div>
						<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
							<div class="flex-1">
								<Label for="invite-max-uses" class="mb-1 text-xs font-medium">Max uses</Label>
								<Input
									id="invite-max-uses"
									bind:value={newLinkMaxUses}
									type="number"
									min="1"
									placeholder="Unlimited"
									class="w-full"
								/>
							</div>
							<div class="flex-1">
								<Label for="invite-expires-at" class="mb-1 text-xs font-medium">Expires at</Label>
								<Input
									id="invite-expires-at"
									bind:value={newLinkExpiresAt}
									type="datetime-local"
									class="w-full"
								/>
							</div>
							<Button disabled={members.createInviteLinkLoading} onclick={submitCreateInviteLink}>
								{#if members.createInviteLinkLoading}
									<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
								{:else}
									<AppIcon name={ICONS.link} class="size-4" />
								{/if}
								Create Link
							</Button>
						</div>
						<p class="text-xs text-muted-foreground">
							Leave both fields blank for unlimited uses that never expire.
						</p>
					</div>

					{#if members.inviteLinks.length}
						<div class="flex flex-col gap-3">
							<div class="flex items-center justify-between gap-3">
								<div>
									<p class="text-sm font-medium">Active Invite Links</p>
									<p class="text-xs text-muted-foreground">
										Track redemptions and revoke links you no longer need.
									</p>
								</div>
								<Badge variant="secondary">{members.inviteLinks.length}</Badge>
							</div>
							<div class="overflow-hidden rounded-xl bg-muted/50">
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
						<div class="flex flex-col gap-3">
							<p class="text-sm font-medium">Members</p>
							<div class="overflow-hidden rounded-xl bg-muted/50">
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
			<div class="flex flex-col gap-4">
				<AppPanelRow
					title="Enable facial recognition"
					description="Process new uploads and group detected faces."
				>
					<Switch
						aria-label="Enable facial recognition"
						bind:checked={faceRecChecked}
						disabled={faceRecToggling}
						onCheckedChange={(next) => toggleFaceRecognition(next)}
					/>
				</AppPanelRow>

				<AppPanelRow
					title="Queue full reprocessing"
					description="Deletes current face inference data, then re-runs detection on all images."
				>
					<Button
						variant="outline"
						disabled={!library?.faceRecognitionEnabled || faceRecToggling || faceRecReprocessing}
						onclick={() => (faceRecReprocessOpen = true)}
					>
						{#if faceRecReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.reload} class="size-4" />
						{/if}
						Reprocess Faces
					</Button>
				</AppPanelRow>
			</div>
		</SettingsSection>

		<!-- Object Detection -->
		<SettingsSection
			title="Object Detection"
			description="Detect objects in image uploads using YOLO26. Disabling removes all detection data."
			icon={ICONS.objectDetection}
		>
			<div class="flex flex-col gap-4">
				<AppPanelRow
					title="Enable object detection"
					description="Process new uploads and index detected objects."
				>
					<Switch
						aria-label="Enable object detection"
						bind:checked={objDetChecked}
						disabled={objDetToggling}
						onCheckedChange={(next) => toggleObjectDetection(next)}
					/>
				</AppPanelRow>

				<AppPanelRow
					title="Browse detected objects"
					description="View detected object labels and their frequency across the library."
				>
					<Button
						variant="outline"
						href={`/libraries/${libraryId}/objects`}
						disabled={!library?.objectDetectionEnabled}
						class={!library?.objectDetectionEnabled ? 'opacity-50' : ''}
					>
						<AppIcon name={ICONS.objectDetection} class="size-4" />
						View Objects
					</Button>
				</AppPanelRow>

				<AppPanelRow
					title="Queue full reprocessing"
					description="Deletes current object detection data, then re-runs detection on all images."
				>
					<Button
						variant="outline"
						disabled={!library?.objectDetectionEnabled || objDetToggling || objDetReprocessing}
						onclick={() => (objDetReprocessOpen = true)}
					>
						{#if objDetReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.reload} class="size-4" />
						{/if}
						Reprocess Objects
					</Button>
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
				<Button
					variant="outline"
					disabled={transcribeReprocessing}
					onclick={() => (transcribeReprocessOpen = true)}
				>
					{#if transcribeReprocessing}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.transcript} class="size-4" />
					{/if}
					Reprocess Transcripts
				</Button>
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
				<Button
					variant="outline"
					disabled={audioDetectReprocessing}
					onclick={() => (audioDetectReprocessOpen = true)}
				>
					{#if audioDetectReprocessing}
						<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
					{:else}
						<AppIcon name={ICONS.audioDetect} class="size-4" />
					{/if}
					Reprocess Audio Detections
				</Button>
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
					aria-label="Enable sharing"
					bind:checked={sharingChecked}
					disabled={sharingToggling}
					onCheckedChange={(next) => toggleSharing(next)}
				/>
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
					<Button
						variant="outline"
						disabled={videoThumbReprocessing}
						onclick={() => (videoThumbReprocessOpen = true)}
					>
						{#if videoThumbReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.image} class="size-4" />
						{/if}
						Regenerate Thumbnails
					</Button>
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
					<Button
						variant="outline"
						disabled={metadataReprocessing}
						onclick={() => (metadataReprocessOpen = true)}
					>
						{#if metadataReprocessing}
							<AppIcon name={ICONS.loading} class="size-4 animate-spin" />
						{:else}
							<AppIcon name={ICONS.reload} class="size-4" />
						{/if}
						Reprocess Metadata
					</Button>
				</div>
			</SettingsSection>
		{/if}

		<!-- Danger Zone -->
		<SettingsSection>
			{#snippet title_()}
				<div class="flex items-center gap-2">
					<AppIcon name={ICONS.warning} class="size-4 shrink-0 text-destructive" />
					<h2 class="text-base font-medium text-destructive">Delete Library</h2>
				</div>
			{/snippet}
			<AppPanelRow
				title="Delete this library"
				description="Permanently remove this library. Must be empty first."
				danger
			>
				<Button
					variant="destructive"
					disabled={!canDeleteLibrary}
					onclick={() => (deleteLibraryOpen = true)}
				>
					<AppIcon name={ICONS.trash} class="size-4" />
					Delete
				</Button>
			</AppPanelRow>
		</SettingsSection>
	</div>

	<ConfirmModal
		bind:open={faceRecDisableOpen}
		title="Disable Facial Recognition"
		message="This will permanently delete all detected faces and people data for this library. This action cannot be undone."
		confirmLabel="Disable & Delete Data"
		confirmClass="error"
		confirmIcon={ICONS.trash}
		pending={faceRecToggling}
		onconfirm={confirmDisableFaceRecognition}
		oncancel={() => {
			// Cancelling never calls the API, but the switch already flipped off
			// optimistically (bits-ui's local $bindable override) — resync from
			// the server so it snaps back to reflect the true (still-enabled)
			// state instead of showing "off" indefinitely.
			refreshLibrary();
		}}
	/>

	<ConfirmModal
		bind:open={objDetDisableOpen}
		title="Disable Object Detection"
		message="This will permanently delete all detected object data for this library. This action cannot be undone."
		confirmLabel="Disable & Delete Data"
		confirmClass="error"
		confirmIcon={ICONS.trash}
		pending={objDetToggling}
		onconfirm={confirmDisableObjectDetection}
		oncancel={() => {
			// Same fix as the facial-recognition disable modal above.
			refreshLibrary();
		}}
	/>

	<ConfirmModal
		bind:open={faceRecReprocessOpen}
		title="Reprocess Facial Recognition"
		message="This deletes all existing face inference data and queues a full rebuild. Results may change, including how photos are grouped into people."
		confirmLabel="Delete Data & Requeue"
		confirmClass="error"
		confirmIcon={ICONS.reload}
		pending={faceRecReprocessing}
		onconfirm={reprocessFaceRecognition}
	/>

	<ConfirmModal
		bind:open={objDetReprocessOpen}
		title="Reprocess Object Detection"
		message="This deletes all existing object detection data and queues a full rebuild. Detected objects may change if the model or settings have been updated."
		confirmLabel="Delete Data & Requeue"
		confirmClass="error"
		confirmIcon={ICONS.reload}
		pending={objDetReprocessing}
		onconfirm={reprocessObjectDetection}
	/>

	<ConfirmModal
		bind:open={metadataReprocessOpen}
		title="Reprocess Photo Metadata"
		message="This re-extracts capture date and GPS location for every photo and video in the library, refreshing the Timeline and Map. Existing metadata is overwritten as each file completes."
		confirmLabel="Queue Reprocessing"
		confirmIcon={ICONS.reload}
		pending={metadataReprocessing}
		onconfirm={reprocessMetadata}
	/>

	<ConfirmModal
		bind:open={videoThumbReprocessOpen}
		title="Regenerate Video Thumbnails"
		message="This queues thumbnail regeneration for all source videos in this library. Existing generated thumbnails will be replaced as new ones complete."
		confirmLabel="Queue Regeneration"
		confirmIcon={ICONS.image}
		pending={videoThumbReprocessing}
		onconfirm={reprocessVideoThumbnails}
	/>

	<ConfirmModal
		bind:open={transcribeReprocessOpen}
		title="Reprocess Transcripts"
		message="This queues transcription for every video and audio file in the library. Existing transcripts will be overwritten when each job completes."
		confirmLabel="Queue Reprocessing"
		confirmIcon={ICONS.transcript}
		pending={transcribeReprocessing}
		onconfirm={reprocessTranscripts}
	/>

	<ConfirmModal
		bind:open={audioDetectReprocessOpen}
		title="Reprocess Audio Detections"
		message="This queues PANNs audio-event detection for every video and audio file with a ready transcript. Existing audio-event tags will be overwritten when each job completes."
		confirmLabel="Queue Reprocessing"
		confirmIcon={ICONS.audioDetect}
		pending={audioDetectReprocessing}
		onconfirm={reprocessAudioDetections}
	/>

	<!-- Delete Library Modal -->
	<AppModal
		bind:open={deleteLibraryOpen}
		title="Delete Library"
		description={`This will permanently delete the library ${library?.name ?? ''}. This action cannot be undone.`}
	>
		<div class="flex flex-col gap-2">
			<Label for="delete-library-confirm">Type 'delete' to confirm</Label>
			<Input
				id="delete-library-confirm"
				bind:value={deleteLibraryConfirmation}
				placeholder="delete"
			/>
		</div>

		<div class="flex w-full justify-end gap-2">
			<Button variant="outline" onclick={() => (deleteLibraryOpen = false)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={deleteLibraryConfirmation !== 'delete'}
				onclick={deleteLibrary}
			>
				<AppIcon name={ICONS.trash} class="size-4" />
				Delete Library
			</Button>
		</div>
	</AppModal>
</div>
