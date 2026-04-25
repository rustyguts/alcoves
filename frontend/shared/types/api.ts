export interface Library {
  id: string;
  name: string;
  emoji: string | null;
  isDefault: boolean;
  faceRecognitionEnabled: boolean;
  objectDetectionEnabled: boolean;
  sharingEnabled: boolean;
  ownerId: string;
  currentUserRole?: "owner" | "admin" | "viewer";
  canManageUsers?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryUserSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export type TranscribeStatus = "queued" | "processing" | "ready" | "failed" | null;
export type AudioDetectStatus = "queued" | "processing" | "ready" | "failed" | null;

export interface AudioDetection {
  id: string;
  fileId: string;
  libraryId: string;
  label: string;
  classIndex: number;
  score: number;
  startSeconds: number;
  endSeconds: number;
  version: number;
  createdAt: string;
}

export interface HighlightFilter {
  id: string;
  libraryId: string;
  createdById: string | null;
  name: string;
  expression: string;
  proximitySeconds: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface HighlightFilterCreate {
  name: string;
  expression: string;
  proximitySeconds?: number;
  color?: string;
}

export interface HighlightFilterPatch {
  name?: string;
  expression?: string;
  proximitySeconds?: number;
  color?: string;
}

export interface LibraryFile {
  id: string;
  libraryId: string;
  parentFolderId: string | null;
  name: string;
  mimeType: string;
  size: number;
  kind: "file";
  duration: number | null;
  width: number | null;
  height: number | null;
  proxyStatus: string | null;
  proxyProgress?: number | null;
  proxyEtaSeconds?: number | null;
  transcribeStatus?: TranscribeStatus;
  transcribeProgress?: number | null;
  transcribeEtaSeconds?: number | null;
  transcribeError?: string | null;
  transcribeVersion?: number;
  transcribedVersion?: number | null;
  transcriptModel?: string | null;
  audioDetectStatus?: AudioDetectStatus;
  audioDetectProgress?: number | null;
  audioDetectEtaSeconds?: number | null;
  audioDetectError?: string | null;
  audioDetectVersion?: number;
  audioDetectedVersion?: number | null;
  audioDetectModel?: string | null;
  thumbnailFileId?: string | null;
  sourceFileId: string | null;
  originalCreatedAt: string | null;
  hash: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: LibraryUserSummary | null;
  tags: LibraryTag[];
}

export interface LibraryFolder {
  id: string;
  libraryId: string;
  parentFolderId: string | null;
  name: string;
  kind: "folder";
  trashedAt: string | null;
  trashFileCount?: number;
  createdAt: string;
  updatedAt: string;
  owner: LibraryUserSummary | null;
  tags: LibraryTag[];
}

export type LibraryEntry = LibraryFile | LibraryFolder;

export interface FolderBreadcrumb {
  id: string;
  name: string;
}

export interface PaginatedFiles {
  entries: LibraryEntry[];
  nextCursor: string | null;
  totalCount: number;
  breadcrumbs: FolderBreadcrumb[];
  currentFolderId: string | null;
}

export interface LibraryMemberWithUser {
  id: string;
  userId: string;
  role: "owner" | "admin" | "viewer";
  isOwner: boolean;
  createdAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

export interface LibraryPendingInvite {
  id: string;
  invitedEmail: string | null;
  role: "admin" | "viewer";
  useCount: number;
  createdAt: string;
  inviteUrl: string;
  invitedBy: LibraryUserSummary;
}

export interface LibraryUsersResponse {
  libraryId: string;
  canManageUsers: boolean;
  members: LibraryMemberWithUser[];
  pendingInvites: LibraryPendingInvite[];
}

export interface InviteLookupResponse {
  id: string;
  role: "admin" | "viewer";
  status: "pending" | "accepted" | "expired" | "revoked" | "already_member" | "not_allowed";
  canAccept: boolean;
  createdAt: string;
  invitedEmail: string | null;
  invitedBy: LibraryUserSummary;
  library: {
    id: string;
    name: string;
  };
}

export interface LibraryTag {
  id: string;
  libraryId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryPerson {
  id: string;
  libraryId: string;
  name: string | null;
  faceCount: number;
  coverFaceDetectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonFace {
  id: string;
  fileId: string;
  fileName: string;
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  imageWidth: number;
  imageHeight: number;
  confidence: number;
  createdAt: string;
}

export interface GlobalSearchResult {
  id: string;
  libraryId: string;
  libraryName: string;
  parentFolderId: string | null;
  targetFolderId: string | null;
  name: string;
  kind: "file" | "folder";
  locationPath: string;
  mimeType?: string;
  size?: number;
  thumbnailFileId?: string;
  updatedAt: string;
  matchReason?: "name" | "object" | "name+object";
  matchedLabels?: string[];
}

export interface GlobalSearchResponse {
  query: string;
  totalCount: number;
  results: GlobalSearchResult[];
}

// ─── Auth ──────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface AuthProvidersResponse {
  google: boolean;
}

// ─── Admin ─────────────────────────────────────────────

export interface AdminStats {
  users: number;
  libraries: number;
  files: number;
  folders: number;
  totalSize: number;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
}

// ─── Media ─────────────────────────────────────────────

export interface PlaybackSource {
  id: string;
  name: string;
  mimeType: string;
  kind: "source" | "proxy";
  streamUrl: string;
  createdAt: string;
}

export interface PlaybackSourcesResponse {
  defaultSourceId: string;
  sources: PlaybackSource[];
}

// ─── Object Detection ──────────────────────────────────

export interface ObjectLabel {
  label: string;
  fileCount: number;
}

export interface ObjectLabelsResponse {
  labels: ObjectLabel[];
}

// ─── Downloads ─────────────────────────────────────────

export interface DownloadEstimate {
  totalSize: number;
  fileCount: number;
}

// ─── Moments ───────────────────────────────────────────

export type MomentExportStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | null;

export interface MomentTagRef {
  id: string;
  name: string;
  color: string;
}

export interface Moment {
  id: string;
  fileId: string;
  libraryId: string;
  createdById: string;
  name: string;
  description: string;
  startSeconds: number;
  endSeconds: number;
  exportStatus: MomentExportStatus;
  exportProgress: number | null;
  exportEtaSeconds: number | null;
  exportVersion: number;
  exportedVersion: number | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: MomentTagRef[];
}

export interface MomentCreate {
  name?: string;
  description?: string;
  startSeconds: number;
  endSeconds: number;
}

export interface MomentPatch {
  name?: string;
  description?: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface MomentShare {
  id: string;
  momentId: string;
  libraryId: string;
  token: string;
  url: string;
  revokedAt: string | null;
  createdAt: string;
}
