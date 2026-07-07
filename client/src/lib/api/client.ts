import { makeApiFetch, type ApiFetch } from './fetch';
import { apiUrl } from './url';
import type {
	AuthUser,
	AuthProvidersResponse,
	SessionInfo,
	AccessToken,
	CreatedAccessToken,
	Library,
	LibraryFile,
	LibraryFolder,
	LibraryTag,
	LibraryPerson,
	PersonFace,
	LibraryUsersResponse,
	PaginatedFiles,
	LibraryMapResponse,
	LibraryFeedResponse,
	TimelineHistogram,
	PlaybackSourcesResponse,
	ObjectLabelsResponse,
	DownloadEstimate,
	GlobalSearchResponse,
	InviteLookupResponse,
	AdminStats,
	AdminUser,
	AppSettings,
	RegistrationMode,
	Moment,
	MomentCreate,
	MomentPatch,
	MomentShare,
	AudioDetection,
	WaveformData,
	HighlightFilter,
	HighlightFilterCreate,
	HighlightFilterPatch,
	OAuthConsentInfo,
	OAuthAuthorizeRequest,
	OAuthConnection,
	DocState,
	DocUpdatesPage
} from '$lib/types/api';

/**
 * Build the typed API client bound to a `fetch`. In server `load`/actions pass
 * `event.fetch`; in the browser use the module-level `api` singleton (window.fetch).
 */
export function createApi(fetchImpl: typeof globalThis.fetch) {
	const f: ApiFetch = makeApiFetch(fetchImpl);

	// ─── Auth ──────────────────────────────────────────────
	const auth = {
		/** GET /api/_auth/session */
		session() {
			return f<{ user?: AuthUser | null }>('/api/_auth/session');
		},
		/** POST /api/auth/login */
		login(body: { email: string; password: string }) {
			return f<void>('/api/auth/login', { method: 'POST', body });
		},
		/** POST /api/auth/register */
		register(body: { name: string; email: string; password: string; inviteToken?: string }) {
			return f<void>('/api/auth/register', { method: 'POST', body });
		},
		/** POST /api/auth/logout */
		logout() {
			return f<void>('/api/auth/logout', { method: 'POST' });
		},
		/** PATCH /api/auth/me */
		updateMe(body: { displayName?: string }) {
			return f<AuthUser>('/api/auth/me', { method: 'PATCH', body });
		},
		/** POST /api/auth/me/avatar */
		uploadAvatar(formData: FormData) {
			return f<AuthUser>('/api/auth/me/avatar', { method: 'POST', body: formData });
		},
		/** GET /api/auth/sessions */
		listSessions() {
			return f<SessionInfo[]>('/api/auth/sessions');
		},
		/** DELETE /api/auth/sessions/:id */
		revokeSession(sessionId: string) {
			return f<void>(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
		},
		/** GET /api/auth/providers */
		providers() {
			return f<AuthProvidersResponse>('/api/auth/providers');
		},
		/** GET /api/auth/tokens — the user's MCP access tokens (no secrets). */
		listTokens() {
			return f<AccessToken[]>('/api/auth/tokens');
		},
		/** POST /api/auth/tokens — mint a token; the plaintext is returned once. */
		createToken(body: { name: string; expiresInDays?: number | null }) {
			return f<CreatedAccessToken>('/api/auth/tokens', { method: 'POST', body });
		},
		/** DELETE /api/auth/tokens/:id — revoke a token. */
		revokeToken(tokenId: string) {
			return f<void>(`/api/auth/tokens/${tokenId}`, { method: 'DELETE' });
		}
	} as const;

	// ─── Libraries ─────────────────────────────────────────
	const libraries = {
		list() {
			return f<Library[]>('/api/libraries');
		},
		create(body: { name: string }) {
			return f<Library>('/api/libraries', { method: 'POST', body });
		},
		get(libraryId: string) {
			return f<Library>(`/api/libraries/${libraryId}`);
		},
		update(
			libraryId: string,
			body: {
				name?: string;
				emoji?: string;
				faceRecognitionEnabled?: boolean;
				objectDetectionEnabled?: boolean;
				sharingEnabled?: boolean;
			}
		) {
			return f<Library>(`/api/libraries/${libraryId}`, { method: 'PATCH', body });
		},
		delete(libraryId: string) {
			return f<void>(`/api/libraries/${libraryId}`, { method: 'DELETE' });
		},
		timeline(
			libraryId: string,
			query?: { type?: 'media' | 'all'; cursor?: string; limit?: string }
		) {
			return f<PaginatedFiles>(`/api/libraries/${libraryId}/timeline`, { query });
		},
		timelineHistogram(libraryId: string, query?: { type?: 'media' | 'all' }) {
			return f<TimelineHistogram>(`/api/libraries/${libraryId}/timeline/histogram`, { query });
		},
		map(libraryId: string) {
			return f<LibraryMapResponse>(`/api/libraries/${libraryId}/map`);
		},
		/** GET /api/libraries/:id/feed — per-library activity feed (cursor-paginated). */
		feed(libraryId: string, query?: { cursor?: string; limit?: string }) {
			return f<LibraryFeedResponse>(`/api/libraries/${libraryId}/feed`, { query });
		},
		metadataReprocess(libraryId: string) {
			return f<{ queuedCount: number }>(`/api/libraries/${libraryId}/metadata/reprocess`, {
				method: 'POST'
			});
		}
	} as const;

	// ─── Files ─────────────────────────────────────────────
	const files = {
		list(
			libraryId: string,
			query?: { folder?: string; trashed?: string; cursor?: string; limit?: string }
		) {
			return f<PaginatedFiles>(`/api/libraries/${libraryId}/files`, { query });
		},
		get(libraryId: string, fileId: string) {
			return f<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}`);
		},
		update(
			libraryId: string,
			fileId: string,
			body: { name?: string; parentFolderId?: string | null }
		) {
			return f<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}`, {
				method: 'PATCH',
				body
			});
		},
		delete(libraryId: string, fileId: string, body?: { fileIds?: string[] }) {
			return f<void>(`/api/libraries/${libraryId}/files/${fileId}`, { method: 'DELETE', body });
		},
		restore(libraryId: string, body: { fileIds: string[] }) {
			return f<void>(`/api/libraries/${libraryId}/files/restore`, { method: 'POST', body });
		},
		purge(libraryId: string, body?: { fileIds?: string[]; folderIds?: string[] }) {
			return f<{ purged: number }>(`/api/libraries/${libraryId}/files/purge`, {
				method: 'POST',
				body
			});
		},
		playbackSources(libraryId: string, fileId: string) {
			return f<PlaybackSourcesResponse>(
				`/api/libraries/${libraryId}/files/${fileId}/playback-sources`
			);
		},
		generateProxy(libraryId: string, fileId: string) {
			return f<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/proxy`, {
				method: 'POST'
			});
		},
		transcribe(libraryId: string, fileId: string) {
			return f<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/transcribe`, {
				method: 'POST'
			});
		},
		transcript(libraryId: string, fileId: string) {
			return f<{ text: string; vtt: string; model: string }>(
				`/api/libraries/${libraryId}/files/${fileId}/transcript`
			);
		},
		generateWaveform(libraryId: string, fileId: string) {
			return f<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/waveform`, {
				method: 'POST'
			});
		},
		waveform(libraryId: string, fileId: string) {
			return f<WaveformData>(`/api/libraries/${libraryId}/files/${fileId}/waveform`);
		},
		audioDetect(libraryId: string, fileId: string) {
			return f<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/audio-detect`, {
				method: 'POST'
			});
		},
		audioDetections(libraryId: string, fileId: string) {
			return f<AudioDetection[]>(`/api/libraries/${libraryId}/files/${fileId}/audio-detections`);
		},
		bulkTranscribe(libraryId: string, fileIds?: string[]) {
			return f<{ enqueued: string[]; skipped: Record<string, string> }>(
				`/api/libraries/${libraryId}/files/bulk-transcribe`,
				{ method: 'POST', body: { fileIds: fileIds ?? [] } }
			);
		},
		bulkAudioDetect(libraryId: string, fileIds?: string[]) {
			return f<{ enqueued: string[]; skipped: Record<string, string> }>(
				`/api/libraries/${libraryId}/files/bulk-audio-detect`,
				{ method: 'POST', body: { fileIds: fileIds ?? [] } }
			);
		},
		reprocessVideoThumbnails(libraryId: string) {
			return f<{ queuedCount: number }>(
				`/api/libraries/${libraryId}/files/video-thumbnails/reprocess`,
				{ method: 'POST' }
			);
		}
	} as const;

	// ─── Folders ───────────────────────────────────────────
	const folders = {
		list(libraryId: string) {
			return f<LibraryFolder[]>(`/api/libraries/${libraryId}/folders`);
		},
		create(libraryId: string, body: { name: string; parentFolderId?: string | null }) {
			return f<LibraryFolder>(`/api/libraries/${libraryId}/folders`, { method: 'POST', body });
		},
		update(libraryId: string, folderId: string, body: { name: string }) {
			return f<LibraryFolder>(`/api/libraries/${libraryId}/folders/${folderId}`, {
				method: 'PATCH',
				body
			});
		},
		delete(libraryId: string, folderId: string) {
			return f<void>(`/api/libraries/${libraryId}/folders/${folderId}`, { method: 'DELETE' });
		},
		move(libraryId: string, folderId: string, body: { parentFolderId: string | null }) {
			return f<void>(`/api/libraries/${libraryId}/folders/${folderId}/move`, {
				method: 'POST',
				body
			});
		},
		restore(libraryId: string, body: { folderIds: string[] }) {
			return f<void>(`/api/libraries/${libraryId}/folders/restore`, { method: 'POST', body });
		}
		// NOTE: no folders.purge — the backend has no /folders/purge route. Purging
		// trashed folders goes through files.purge({ folderIds }) (POST /files/purge).
	} as const;

	// ─── Tags ──────────────────────────────────────────────
	const tags = {
		list(libraryId: string) {
			return f<LibraryTag[]>(`/api/libraries/${libraryId}/tags`);
		},
		create(libraryId: string, body: { name: string; color?: string }) {
			return f<LibraryTag>(`/api/libraries/${libraryId}/tags`, { method: 'POST', body });
		},
		update(libraryId: string, tagId: string, body: { name?: string; color?: string }) {
			return f<LibraryTag>(`/api/libraries/${libraryId}/tags/${tagId}`, { method: 'PATCH', body });
		},
		delete(libraryId: string, tagId: string) {
			return f<void>(`/api/libraries/${libraryId}/tags/${tagId}`, { method: 'DELETE' });
		},
		// Backend returns the updated tag list as a TOP-LEVEL array (see tag.go).
		syncFileTags(libraryId: string, fileId: string, body: { tagIds: string[] }) {
			return f<LibraryTag[]>(`/api/libraries/${libraryId}/files/${fileId}/tags`, {
				method: 'PUT',
				body
			});
		},
		syncFolderTags(libraryId: string, folderId: string, body: { tagIds: string[] }) {
			return f<LibraryTag[]>(`/api/libraries/${libraryId}/folders/${folderId}/tags`, {
				method: 'PUT',
				body
			});
		}
	} as const;

	// ─── Highlight filters ─────────────────────────────────
	const highlightFilters = {
		list(libraryId: string) {
			return f<HighlightFilter[]>(`/api/libraries/${libraryId}/highlight-filters`);
		},
		create(libraryId: string, body: HighlightFilterCreate) {
			return f<HighlightFilter>(`/api/libraries/${libraryId}/highlight-filters`, {
				method: 'POST',
				body
			});
		},
		update(libraryId: string, filterId: string, body: HighlightFilterPatch) {
			return f<HighlightFilter>(`/api/libraries/${libraryId}/highlight-filters/${filterId}`, {
				method: 'PATCH',
				body
			});
		},
		remove(libraryId: string, filterId: string) {
			return f<void>(`/api/libraries/${libraryId}/highlight-filters/${filterId}`, {
				method: 'DELETE'
			});
		}
	} as const;

	// ─── Members ───────────────────────────────────────────
	const members = {
		list(libraryId: string) {
			return f<LibraryUsersResponse>(`/api/libraries/${libraryId}/users`);
		},
		createInviteLink(
			libraryId: string,
			body?: { maxUses?: number | null; expiresAt?: string | null }
		) {
			return f<{
				id: string;
				token: string;
				inviteUrl: string;
				maxUses: number | null;
				expiresAt: string | null;
			}>(`/api/libraries/${libraryId}/users/invite-link`, { method: 'POST', body: body ?? {} });
		},
		updateRole(libraryId: string, userId: string, body: { role: 'admin' | 'viewer' }) {
			return f<void>(`/api/libraries/${libraryId}/users/${userId}`, { method: 'PATCH', body });
		},
		remove(libraryId: string, userId: string) {
			return f<void>(`/api/libraries/${libraryId}/users/${userId}`, { method: 'DELETE' });
		},
		revokeInvite(libraryId: string, inviteId: string) {
			return f<void>(`/api/libraries/${libraryId}/users/invites/${inviteId}`, { method: 'DELETE' });
		}
	} as const;

	// ─── People ────────────────────────────────────────────
	const people = {
		list(libraryId: string) {
			return f<LibraryPerson[]>(`/api/libraries/${libraryId}/people`);
		},
		update(
			libraryId: string,
			personId: string,
			body: { name?: string; coverFaceDetectionId?: string }
		) {
			return f<LibraryPerson>(`/api/libraries/${libraryId}/people/${personId}`, {
				method: 'PATCH',
				body
			});
		},
		listFaces(libraryId: string, personId: string) {
			return f<PersonFace[]>(`/api/libraries/${libraryId}/people/${personId}/faces`);
		},
		splitFace(libraryId: string, personId: string, faceId: string, body?: { name?: string }) {
			return f<void>(`/api/libraries/${libraryId}/people/${personId}/faces/${faceId}/split`, {
				method: 'POST',
				body
			});
		},
		merge(libraryId: string, body: { personIds: string[] }) {
			return f<void>(`/api/libraries/${libraryId}/people/merge`, { method: 'POST', body });
		},
		reprocess(libraryId: string) {
			return f<{ queuedCount: number }>(`/api/libraries/${libraryId}/face-recognition/reprocess`, {
				method: 'POST'
			});
		},
		/** URL builder: /api/libraries/:id/people/:personId/thumbnail */
		thumbnailUrl(libraryId: string, personId: string, version?: string) {
			const v = version ? `?v=${encodeURIComponent(version)}` : '';
			return apiUrl(`/api/libraries/${libraryId}/people/${personId}/thumbnail${v}`);
		}
	} as const;

	// ─── Objects ───────────────────────────────────────────
	const objects = {
		labels(libraryId: string) {
			return f<ObjectLabelsResponse>(`/api/libraries/${libraryId}/objects/labels`);
		},
		reprocess(libraryId: string) {
			return f<{ queuedCount: number }>(`/api/libraries/${libraryId}/object-detection/reprocess`, {
				method: 'POST'
			});
		}
	} as const;

	// ─── Downloads ─────────────────────────────────────────
	const downloads = {
		estimate(libraryId: string, body: { fileIds: string[]; folderIds: string[] }) {
			return f<DownloadEstimate>(`/api/libraries/${libraryId}/download-estimate`, {
				method: 'POST',
				body
			});
		},
		/** Download URL (POST /download streams a zip; useDownloadZip drives it with raw fetch). */
		url(libraryId: string) {
			return apiUrl(`/api/libraries/${libraryId}/download`);
		}
	} as const;

	// ─── Search ────────────────────────────────────────────
	const search = {
		query(query: { q: string; limit?: string }) {
			return f<GlobalSearchResponse>('/api/search', { query });
		}
	} as const;

	// ─── Invites ───────────────────────────────────────────
	const invites = {
		lookup(token: string) {
			return f<InviteLookupResponse>(`/api/invites/${token}`);
		},
		accept(token: string) {
			return f<{ libraryId: string; libraryName: string }>(`/api/invites/${token}/accept`, {
				method: 'POST'
			});
		}
	} as const;

	// ─── Admin ─────────────────────────────────────────────
	const admin = {
		stats() {
			return f<AdminStats>('/api/admin/stats');
		},
		listUsers() {
			return f<AdminUser[]>('/api/admin/users');
		},
		updateUserRole(userId: string, body: { role: 'owner' | 'member' }) {
			return f<{ id: string; role: 'owner' | 'member' }>(`/api/admin/users/${userId}`, {
				method: 'PATCH',
				body
			});
		},
		getSettings() {
			return f<AppSettings>('/api/admin/settings');
		},
		updateSettings(body: Partial<AppSettings>) {
			return f<AppSettings>('/api/admin/settings', { method: 'PATCH', body });
		},
		controlJob(queueName: string, jobId: string, body: { action: 'retry' | 'remove' }) {
			return f<void>(`/api/admin/jobs/${encodeURIComponent(queueName)}/${jobId}`, {
				method: 'POST',
				body
			});
		},
		purgeQueue(queueName: string) {
			return f<{ total: number }>(`/api/admin/jobs/${encodeURIComponent(queueName)}/purge`, {
				method: 'POST'
			});
		}
	} as const;

	// ─── Moments ───────────────────────────────────────────
	const moments = {
		list(libraryId: string, fileId: string) {
			return f<Moment[]>(`/api/libraries/${libraryId}/files/${fileId}/moments`);
		},
		create(libraryId: string, fileId: string, body: MomentCreate) {
			return f<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments`, {
				method: 'POST',
				body
			});
		},
		get(libraryId: string, fileId: string, momentId: string) {
			return f<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}`);
		},
		update(libraryId: string, fileId: string, momentId: string, body: MomentPatch) {
			return f<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}`, {
				method: 'PATCH',
				body
			});
		},
		delete(libraryId: string, fileId: string, momentId: string) {
			return f<void>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}`, {
				method: 'DELETE'
			});
		},
		syncTags(libraryId: string, fileId: string, momentId: string, tagIds: string[]) {
			return f<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/tags`, {
				method: 'PUT',
				body: { tagIds }
			});
		},
		export(libraryId: string, fileId: string, momentId: string) {
			return f<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/export`, {
				method: 'POST'
			});
		},
		downloadUrl(libraryId: string, fileId: string, momentId: string): string {
			return apiUrl(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/download`);
		},
		createShare(libraryId: string, fileId: string, momentId: string) {
			return f<MomentShare>(
				`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/shares`,
				{ method: 'POST' }
			);
		},
		listShares(libraryId: string, fileId: string, momentId: string) {
			return f<MomentShare[]>(
				`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/shares`
			);
		},
		revokeShare(libraryId: string, fileId: string, momentId: string, token: string) {
			return f<void>(
				`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/shares/${token}`,
				{ method: 'DELETE' }
			);
		}
	} as const;

	// ─── Documents (live collaborative markdown) ───────────
	const documents = {
		/**
		 * Create an empty markdown file via the direct-upload endpoint — the
		 * same ingest pipeline as uploads (text/* runs no post-ingest jobs).
		 * The name is URI-encoded because browsers reject non-ISO-8859-1
		 * header values; X-Upload-Name-Encoded tells the server to decode.
		 */
		create(libraryId: string, body: { name: string; folderId?: string | null }) {
			const name = /\.(md|markdown)$/i.test(body.name) ? body.name : `${body.name}.md`;
			const headers: Record<string, string> = {
				'X-Upload-Name': encodeURIComponent(name),
				'X-Upload-Name-Encoded': '1',
				'X-Upload-Mime-Type': 'text/markdown'
			};
			if (body.folderId) headers['X-Upload-Folder-Id'] = body.folderId;
			return f<LibraryFile>(`/api/libraries/${libraryId}/files`, { method: 'POST', headers });
		},
		/** GET .../doc — full sync state, or {exists:false, text} for an unseeded .md. */
		get(libraryId: string, fileId: string) {
			return f<DocState>(`/api/libraries/${libraryId}/files/${fileId}/doc`);
		},
		/** POST .../doc/init — exactly-once seed; 409 carries the winner's state. */
		init(libraryId: string, fileId: string, body: { update: string }) {
			return f<{ seq: number }>(`/api/libraries/${libraryId}/files/${fileId}/doc/init`, {
				method: 'POST',
				body
			});
		},
		/** POST .../doc/updates — append one opaque Yjs update (base64). */
		postUpdate(
			libraryId: string,
			fileId: string,
			body: { data: string },
			opts?: { keepalive?: boolean }
		) {
			return f<{ seq: number }>(`/api/libraries/${libraryId}/files/${fileId}/doc/updates`, {
				method: 'POST',
				body,
				keepalive: opts?.keepalive
			});
		},
		/** GET .../doc/updates?since= — gap replay / polling fallback. */
		updatesSince(libraryId: string, fileId: string, since: number) {
			return f<DocUpdatesPage>(`/api/libraries/${libraryId}/files/${fileId}/doc/updates`, {
				query: { since }
			});
		},
		/** PUT .../doc/snapshot — client-computed compaction; 409 = stale (benign). */
		snapshot(
			libraryId: string,
			fileId: string,
			body: { snapshot: string; upTo: number; text: string },
			opts?: { keepalive?: boolean }
		) {
			return f<{ snapshotSeq: number }>(
				`/api/libraries/${libraryId}/files/${fileId}/doc/snapshot`,
				{ method: 'PUT', body, keepalive: opts?.keepalive }
			);
		},
		/** Absolute URL for the per-document WebSocket (ws:// or wss://). */
		wsUrl(libraryId: string, fileId: string): string {
			const http = apiUrl(`/api/libraries/${libraryId}/files/${fileId}/doc/ws`);
			const abs = http.startsWith('http')
				? http
				: typeof window !== 'undefined'
					? window.location.origin + http
					: http;
			return abs.replace(/^http/, 'ws');
		}
	} as const;

	// ─── Meta (public) ─────────────────────────────────────
	const meta = {
		registrationMode() {
			return f<{ mode: RegistrationMode }>('/api/_meta/registration-mode');
		}
	} as const;

	// ─── MCP OAuth (custom-connector authorization) ────────
	const oauth = {
		/** GET /api/oauth/authorize — validate a request and fetch consent data. */
		authorize(query: Record<string, string>) {
			return f<OAuthConsentInfo>('/api/oauth/authorize', { query });
		},
		/** POST /api/oauth/authorize/decision — approve/deny; returns the redirect target. */
		decision(body: { consentToken: string; approve: boolean } & OAuthAuthorizeRequest) {
			return f<{ redirect: string }>('/api/oauth/authorize/decision', { method: 'POST', body });
		},
		/** GET /api/oauth/connections — clients the user has authorized for MCP. */
		connections() {
			return f<{ connections: OAuthConnection[] }>('/api/oauth/connections');
		},
		/** DELETE /api/oauth/connections/:clientId — disconnect a client. */
		revokeConnection(clientId: string) {
			return f<void>(`/api/oauth/connections/${encodeURIComponent(clientId)}`, {
				method: 'DELETE'
			});
		}
	} as const;

	return {
		auth,
		libraries,
		files,
		folders,
		tags,
		highlightFilters,
		members,
		people,
		objects,
		downloads,
		search,
		invites,
		admin,
		moments,
		documents,
		meta,
		oauth
	} as const;
}

export type Api = ReturnType<typeof createApi>;
