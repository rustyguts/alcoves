import { apiFetch, apiUrl } from "~/utils/api-fetch";
import type {
  AuthUser,
  AuthProvidersResponse,
  SessionInfo,
  Library,
  LibraryFile,
  LibraryFolder,
  LibraryTag,
  LibraryPerson,
  PersonFace,
  LibraryUsersResponse,
  PaginatedFiles,
  PlaybackSourcesResponse,
  ObjectLabelsResponse,
  DownloadEstimate,
  GlobalSearchResponse,
  InviteLookupResponse,
  AdminStats,
  AdminUser,
  Moment,
  MomentCreate,
  MomentPatch,
  MomentShare,
  AudioDetection,
  WaveformData,
  HighlightFilter,
  HighlightFilterCreate,
  HighlightFilterPatch,
} from "~~/shared/types/api";

// ─── Auth ──────────────────────────────────────────────

const auth = {
  /** GET /api/_auth/session */
  session() {
    return apiFetch<{ user?: AuthUser }>("/api/_auth/session");
  },

  /** POST /api/auth/login */
  login(body: { email: string; password: string }) {
    return apiFetch<void>("/api/auth/login", { method: "POST", body });
  },

  /** POST /api/auth/register */
  register(body: { name: string; email: string; password: string }) {
    return apiFetch<void>("/api/auth/register", { method: "POST", body });
  },

  /** POST /api/auth/logout */
  logout() {
    return apiFetch<void>("/api/auth/logout", { method: "POST" });
  },

  /** PATCH /api/auth/me */
  updateMe(body: { displayName?: string }) {
    return apiFetch<AuthUser>("/api/auth/me", { method: "PATCH", body });
  },

  /** POST /api/auth/me/avatar */
  uploadAvatar(formData: FormData) {
    return apiFetch<AuthUser>("/api/auth/me/avatar", { method: "POST", body: formData });
  },

  /** GET /api/auth/sessions */
  listSessions() {
    return apiFetch<SessionInfo[]>("/api/auth/sessions");
  },

  /** DELETE /api/auth/sessions/:id */
  revokeSession(sessionId: string) {
    return apiFetch<void>(`/api/auth/sessions/${sessionId}`, { method: "DELETE" });
  },

  /** GET /api/auth/providers */
  providers() {
    return apiFetch<AuthProvidersResponse>("/api/auth/providers");
  },
} as const;

// ─── Libraries ─────────────────────────────────────────

const libraries = {
  /** GET /api/libraries */
  list() {
    return apiFetch<Library[]>("/api/libraries");
  },

  /** POST /api/libraries */
  create(body: { name: string }) {
    return apiFetch<Library>("/api/libraries", { method: "POST", body });
  },

  /** GET /api/libraries/:id */
  get(libraryId: string) {
    return apiFetch<Library>(`/api/libraries/${libraryId}`);
  },

  /** PATCH /api/libraries/:id */
  update(
    libraryId: string,
    body: {
      name?: string;
      emoji?: string;
      faceRecognitionEnabled?: boolean;
      objectDetectionEnabled?: boolean;
      sharingEnabled?: boolean;
    },
  ) {
    return apiFetch<Library>(`/api/libraries/${libraryId}`, { method: "PATCH", body });
  },

  /** DELETE /api/libraries/:id */
  delete(libraryId: string) {
    return apiFetch<void>(`/api/libraries/${libraryId}`, { method: "DELETE" });
  },
} as const;

// ─── Files ─────────────────────────────────────────────

const files = {
  /** GET /api/libraries/:id/files */
  list(
    libraryId: string,
    query?: { folder?: string; trashed?: string; cursor?: string; limit?: string },
  ) {
    return apiFetch<PaginatedFiles>(`/api/libraries/${libraryId}/files`, { query });
  },

  /** GET /api/libraries/:id/files/:fileId */
  get(libraryId: string, fileId: string) {
    return apiFetch<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}`);
  },

  /** PATCH /api/libraries/:id/files/:fileId */
  update(
    libraryId: string,
    fileId: string,
    body: { name?: string; parentFolderId?: string | null },
  ) {
    return apiFetch<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}`, {
      method: "PATCH",
      body,
    });
  },

  /** DELETE /api/libraries/:id/files/:fileId */
  delete(libraryId: string, fileId: string, body?: { fileIds?: string[] }) {
    return apiFetch<void>(`/api/libraries/${libraryId}/files/${fileId}`, {
      method: "DELETE",
      body,
    });
  },

  /** POST /api/libraries/:id/files/restore */
  restore(libraryId: string, body: { fileIds: string[] }) {
    return apiFetch<void>(`/api/libraries/${libraryId}/files/restore`, { method: "POST", body });
  },

  /** POST /api/libraries/:id/files/purge */
  purge(libraryId: string, body?: { fileIds?: string[]; folderIds?: string[] }) {
    return apiFetch<{ purged: number }>(`/api/libraries/${libraryId}/files/purge`, {
      method: "POST",
      body,
    });
  },

  /** GET /api/libraries/:id/files/:fileId/playback-sources */
  playbackSources(libraryId: string, fileId: string) {
    return apiFetch<PlaybackSourcesResponse>(
      `/api/libraries/${libraryId}/files/${fileId}/playback-sources`,
    );
  },

  /** POST /api/libraries/:id/files/:fileId/proxy */
  generateProxy(libraryId: string, fileId: string) {
    return apiFetch<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/proxy`, {
      method: "POST",
    });
  },

  /** POST /api/libraries/:id/files/:fileId/transcribe */
  transcribe(libraryId: string, fileId: string) {
    return apiFetch<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/transcribe`, {
      method: "POST",
    });
  },

  /** GET /api/libraries/:id/files/:fileId/transcript */
  transcript(libraryId: string, fileId: string) {
    return apiFetch<{ text: string; vtt: string; model: string }>(
      `/api/libraries/${libraryId}/files/${fileId}/transcript`,
    );
  },

  /** POST /api/libraries/:id/files/:fileId/waveform — (re)generate waveform */
  generateWaveform(libraryId: string, fileId: string) {
    return apiFetch<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/waveform`, {
      method: "POST",
    });
  },

  /** GET /api/libraries/:id/files/:fileId/waveform */
  waveform(libraryId: string, fileId: string) {
    return apiFetch<WaveformData>(`/api/libraries/${libraryId}/files/${fileId}/waveform`);
  },

  /** POST /api/libraries/:id/files/:fileId/audio-detect */
  audioDetect(libraryId: string, fileId: string) {
    return apiFetch<LibraryFile>(`/api/libraries/${libraryId}/files/${fileId}/audio-detect`, {
      method: "POST",
    });
  },

  /** GET /api/libraries/:id/files/:fileId/audio-detections */
  audioDetections(libraryId: string, fileId: string) {
    return apiFetch<AudioDetection[]>(
      `/api/libraries/${libraryId}/files/${fileId}/audio-detections`,
    );
  },

  /**
   * POST /api/libraries/:id/files/bulk-transcribe
   * Empty fileIds = every video/audio file in the library.
   */
  bulkTranscribe(libraryId: string, fileIds?: string[]) {
    return apiFetch<{ enqueued: string[]; skipped: Record<string, string> }>(
      `/api/libraries/${libraryId}/files/bulk-transcribe`,
      {
        method: "POST",
        body: { fileIds: fileIds ?? [] },
      },
    );
  },

  /**
   * POST /api/libraries/:id/files/bulk-audio-detect
   * Empty fileIds = every video/audio file in the library that has a
   * ready transcript.
   */
  bulkAudioDetect(libraryId: string, fileIds?: string[]) {
    return apiFetch<{ enqueued: string[]; skipped: Record<string, string> }>(
      `/api/libraries/${libraryId}/files/bulk-audio-detect`,
      {
        method: "POST",
        body: { fileIds: fileIds ?? [] },
      },
    );
  },

  /** POST /api/libraries/:id/files/video-thumbnails/reprocess */
  reprocessVideoThumbnails(libraryId: string) {
    return apiFetch<{ queuedCount: number }>(
      `/api/libraries/${libraryId}/files/video-thumbnails/reprocess`,
      {
        method: "POST",
      },
    );
  },
} as const;

// ─── Folders ───────────────────────────────────────────

const folders = {
  /** GET /api/libraries/:id/folders */
  list(libraryId: string) {
    return apiFetch<LibraryFolder[]>(`/api/libraries/${libraryId}/folders`);
  },

  /** POST /api/libraries/:id/folders */
  create(libraryId: string, body: { name: string; parentFolderId?: string | null }) {
    return apiFetch<LibraryFolder>(`/api/libraries/${libraryId}/folders`, { method: "POST", body });
  },

  /** PATCH /api/libraries/:id/folders/:folderId */
  update(libraryId: string, folderId: string, body: { name: string }) {
    return apiFetch<LibraryFolder>(`/api/libraries/${libraryId}/folders/${folderId}`, {
      method: "PATCH",
      body,
    });
  },

  /** DELETE /api/libraries/:id/folders/:folderId */
  delete(libraryId: string, folderId: string) {
    return apiFetch<void>(`/api/libraries/${libraryId}/folders/${folderId}`, { method: "DELETE" });
  },

  /** POST /api/libraries/:id/folders/:folderId/move */
  move(libraryId: string, folderId: string, body: { parentFolderId: string | null }) {
    return apiFetch<void>(`/api/libraries/${libraryId}/folders/${folderId}/move`, {
      method: "POST",
      body,
    });
  },

  /** POST /api/libraries/:id/folders/restore */
  restore(libraryId: string, body: { folderIds: string[] }) {
    return apiFetch<void>(`/api/libraries/${libraryId}/folders/restore`, { method: "POST", body });
  },

  /** POST /api/libraries/:id/folders/purge */
  purge(libraryId: string, body?: { folderIds?: string[] }) {
    return apiFetch<{ purged: number }>(`/api/libraries/${libraryId}/folders/purge`, {
      method: "POST",
      body,
    });
  },
} as const;

// ─── Tags ──────────────────────────────────────────────

const tags = {
  /** GET /api/libraries/:id/tags */
  list(libraryId: string) {
    return apiFetch<LibraryTag[]>(`/api/libraries/${libraryId}/tags`);
  },

  /** POST /api/libraries/:id/tags */
  create(libraryId: string, body: { name: string; color?: string }) {
    return apiFetch<LibraryTag>(`/api/libraries/${libraryId}/tags`, { method: "POST", body });
  },

  /** PATCH /api/libraries/:id/tags/:tagId */
  update(libraryId: string, tagId: string, body: { name?: string; color?: string }) {
    return apiFetch<LibraryTag>(`/api/libraries/${libraryId}/tags/${tagId}`, {
      method: "PATCH",
      body,
    });
  },

  /** DELETE /api/libraries/:id/tags/:tagId */
  delete(libraryId: string, tagId: string) {
    return apiFetch<void>(`/api/libraries/${libraryId}/tags/${tagId}`, { method: "DELETE" });
  },

  /** PUT /api/libraries/:id/files/:fileId/tags */
  syncFileTags(libraryId: string, fileId: string, body: { tagIds: string[] }) {
    return apiFetch<{ tags: LibraryTag[] }>(`/api/libraries/${libraryId}/files/${fileId}/tags`, {
      method: "PUT",
      body,
    });
  },

  /** PUT /api/libraries/:id/folders/:folderId/tags */
  syncFolderTags(libraryId: string, folderId: string, body: { tagIds: string[] }) {
    return apiFetch<{ tags: LibraryTag[] }>(
      `/api/libraries/${libraryId}/folders/${folderId}/tags`,
      {
        method: "PUT",
        body,
      },
    );
  },
} as const;

// ─── Highlight filters ─────────────────────────────────

const highlightFilters = {
  /** GET /api/libraries/:id/highlight-filters */
  list(libraryId: string) {
    return apiFetch<HighlightFilter[]>(`/api/libraries/${libraryId}/highlight-filters`);
  },

  /** POST /api/libraries/:id/highlight-filters */
  create(libraryId: string, body: HighlightFilterCreate) {
    return apiFetch<HighlightFilter>(`/api/libraries/${libraryId}/highlight-filters`, {
      method: "POST",
      body,
    });
  },

  /** PATCH /api/libraries/:id/highlight-filters/:filterId */
  update(libraryId: string, filterId: string, body: HighlightFilterPatch) {
    return apiFetch<HighlightFilter>(`/api/libraries/${libraryId}/highlight-filters/${filterId}`, {
      method: "PATCH",
      body,
    });
  },

  /** DELETE /api/libraries/:id/highlight-filters/:filterId */
  remove(libraryId: string, filterId: string) {
    return apiFetch<void>(`/api/libraries/${libraryId}/highlight-filters/${filterId}`, {
      method: "DELETE",
    });
  },
} as const;

// ─── Members ───────────────────────────────────────────

const members = {
  /** GET /api/libraries/:id/users */
  list(libraryId: string) {
    return apiFetch<LibraryUsersResponse>(`/api/libraries/${libraryId}/users`);
  },

  /** POST /api/libraries/:id/users/invite-email */
  inviteByEmail(libraryId: string, body: { email: string; role: "admin" | "viewer" }) {
    return apiFetch<{
      action: "added" | "invited" | "already_member";
      invite?: { inviteUrl: string };
    }>(`/api/libraries/${libraryId}/users/invite-email`, { method: "POST", body });
  },

  /** POST /api/libraries/:id/users/invite-link */
  createInviteLink(libraryId: string) {
    return apiFetch<{ inviteUrl: string }>(`/api/libraries/${libraryId}/users/invite-link`, {
      method: "POST",
    });
  },

  /** PATCH /api/libraries/:id/users/:userId */
  updateRole(libraryId: string, userId: string, body: { role: "admin" | "viewer" }) {
    return apiFetch<void>(`/api/libraries/${libraryId}/users/${userId}`, { method: "PATCH", body });
  },

  /** DELETE /api/libraries/:id/users/:userId */
  remove(libraryId: string, userId: string) {
    return apiFetch<void>(`/api/libraries/${libraryId}/users/${userId}`, { method: "DELETE" });
  },

  /** DELETE /api/libraries/:id/users/invites/:inviteId */
  revokeInvite(libraryId: string, inviteId: string) {
    return apiFetch<void>(`/api/libraries/${libraryId}/users/invites/${inviteId}`, {
      method: "DELETE",
    });
  },
} as const;

// ─── People ────────────────────────────────────────────

const people = {
  /** GET /api/libraries/:id/people */
  list(libraryId: string) {
    return apiFetch<LibraryPerson[]>(`/api/libraries/${libraryId}/people`);
  },

  /** PATCH /api/libraries/:id/people/:personId */
  update(
    libraryId: string,
    personId: string,
    body: { name?: string; coverFaceDetectionId?: string },
  ) {
    return apiFetch<LibraryPerson>(`/api/libraries/${libraryId}/people/${personId}`, {
      method: "PATCH",
      body,
    });
  },

  /** GET /api/libraries/:id/people/:personId/faces */
  listFaces(libraryId: string, personId: string) {
    return apiFetch<PersonFace[]>(`/api/libraries/${libraryId}/people/${personId}/faces`);
  },

  /** POST /api/libraries/:id/people/:personId/faces/:faceId/split */
  splitFace(libraryId: string, personId: string, faceId: string, body?: { name?: string }) {
    return apiFetch<void>(`/api/libraries/${libraryId}/people/${personId}/faces/${faceId}/split`, {
      method: "POST",
      body,
    });
  },

  /** POST /api/libraries/:id/people/merge */
  merge(libraryId: string, body: { personIds: string[] }) {
    return apiFetch<void>(`/api/libraries/${libraryId}/people/merge`, { method: "POST", body });
  },

  /** POST /api/libraries/:id/face-recognition/reprocess */
  reprocess(libraryId: string) {
    return apiFetch<{ queuedCount: number }>(
      `/api/libraries/${libraryId}/face-recognition/reprocess`,
      {
        method: "POST",
      },
    );
  },

  /** URL builder: /api/libraries/:id/people/:personId/thumbnail */
  thumbnailUrl(libraryId: string, personId: string, version?: string) {
    const v = version ? `?v=${encodeURIComponent(version)}` : "";
    return apiUrl(`/api/libraries/${libraryId}/people/${personId}/thumbnail${v}`);
  },
} as const;

// ─── Objects ───────────────────────────────────────────

const objects = {
  /** GET /api/libraries/:id/objects/labels */
  labels(libraryId: string) {
    return apiFetch<ObjectLabelsResponse>(`/api/libraries/${libraryId}/objects/labels`);
  },

  /** POST /api/libraries/:id/object-detection/reprocess */
  reprocess(libraryId: string) {
    return apiFetch<{ queuedCount: number }>(
      `/api/libraries/${libraryId}/object-detection/reprocess`,
      {
        method: "POST",
      },
    );
  },
} as const;

// ─── Downloads ─────────────────────────────────────────

const downloads = {
  /** POST /api/libraries/:id/download-estimate */
  estimate(libraryId: string, body: { fileIds: string[]; folderIds: string[] }) {
    return apiFetch<DownloadEstimate>(`/api/libraries/${libraryId}/download-estimate`, {
      method: "POST",
      body,
    });
  },

  // Note: POST /api/libraries/:id/download uses raw fetch for blob streaming.
  // Use the useDownloadZip composable instead.
} as const;

// ─── Search ────────────────────────────────────────────

const search = {
  /** GET /api/search */
  query(query: { q: string; limit?: string }) {
    return apiFetch<GlobalSearchResponse>("/api/search", { query });
  },
} as const;

// ─── Invites ───────────────────────────────────────────

const invites = {
  /** GET /api/invites/:token */
  lookup(token: string) {
    return apiFetch<InviteLookupResponse>(`/api/invites/${token}`);
  },

  /** POST /api/invites/:token/accept */
  accept(token: string) {
    return apiFetch<{ libraryId: string; libraryName: string }>(`/api/invites/${token}/accept`, {
      method: "POST",
    });
  },
} as const;

// ─── Admin ─────────────────────────────────────────────

const admin = {
  /** GET /api/admin/stats */
  stats() {
    return apiFetch<AdminStats>("/api/admin/stats");
  },

  /** GET /api/admin/users */
  listUsers() {
    return apiFetch<AdminUser[]>("/api/admin/users");
  },

  /** PATCH /api/admin/users/:userId */
  updateUserRole(userId: string, body: { role: "owner" | "member" }) {
    return apiFetch<{ id: string; role: "owner" | "member" }>(`/api/admin/users/${userId}`, {
      method: "PATCH",
      body,
    });
  },

  /** POST /api/admin/jobs/:queueName/:jobId */
  controlJob(queueName: string, jobId: string, body: { action: "retry" | "remove" }) {
    return apiFetch<void>(`/api/admin/jobs/${encodeURIComponent(queueName)}/${jobId}`, {
      method: "POST",
      body,
    });
  },

  /** POST /api/admin/jobs/:queueName/purge */
  purgeQueue(queueName: string) {
    return apiFetch<{ total: number }>(`/api/admin/jobs/${encodeURIComponent(queueName)}/purge`, {
      method: "POST",
    });
  },

  // Note: GET /api/admin/jobs/stream is SSE, not wrapped here.
} as const;

// ─── Moments ───────────────────────────────────────────

const moments = {
  /** GET /api/libraries/:id/files/:fileId/moments */
  list(libraryId: string, fileId: string) {
    return apiFetch<Moment[]>(`/api/libraries/${libraryId}/files/${fileId}/moments`);
  },

  /** POST /api/libraries/:id/files/:fileId/moments */
  create(libraryId: string, fileId: string, body: MomentCreate) {
    return apiFetch<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments`, {
      method: "POST",
      body,
    });
  },

  /** GET /api/libraries/:id/files/:fileId/moments/:momentId */
  get(libraryId: string, fileId: string, momentId: string) {
    return apiFetch<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}`);
  },

  /** PATCH /api/libraries/:id/files/:fileId/moments/:momentId */
  update(libraryId: string, fileId: string, momentId: string, body: MomentPatch) {
    return apiFetch<Moment>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}`, {
      method: "PATCH",
      body,
    });
  },

  /** DELETE /api/libraries/:id/files/:fileId/moments/:momentId */
  delete(libraryId: string, fileId: string, momentId: string) {
    return apiFetch<void>(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}`, {
      method: "DELETE",
    });
  },

  /** PUT /api/libraries/:id/files/:fileId/moments/:momentId/tags */
  syncTags(libraryId: string, fileId: string, momentId: string, tagIds: string[]) {
    return apiFetch<Moment>(
      `/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/tags`,
      { method: "PUT", body: { tagIds } },
    );
  },

  /** POST /api/libraries/:id/files/:fileId/moments/:momentId/export */
  export(libraryId: string, fileId: string, momentId: string) {
    return apiFetch<Moment>(
      `/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/export`,
      { method: "POST" },
    );
  },

  /** Download URL (browser navigates to this) */
  downloadUrl(libraryId: string, fileId: string, momentId: string): string {
    return apiUrl(`/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/download`);
  },

  /** POST /api/libraries/:id/files/:fileId/moments/:momentId/shares */
  createShare(libraryId: string, fileId: string, momentId: string) {
    return apiFetch<MomentShare>(
      `/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/shares`,
      { method: "POST" },
    );
  },

  /** GET /api/libraries/:id/files/:fileId/moments/:momentId/shares */
  listShares(libraryId: string, fileId: string, momentId: string) {
    return apiFetch<MomentShare[]>(
      `/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/shares`,
    );
  },

  /** DELETE /api/libraries/:id/files/:fileId/moments/:momentId/shares/:token */
  revokeShare(libraryId: string, fileId: string, momentId: string, token: string) {
    return apiFetch<void>(
      `/api/libraries/${libraryId}/files/${fileId}/moments/${momentId}/shares/${token}`,
      { method: "DELETE" },
    );
  },
} as const;

// ─── Combined export ───────────────────────────────────

export const api = {
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
} as const;
