export interface Library {
  id: string;
  name: string;
  emoji: string | null;
  isDefault: boolean;
  faceRecognitionEnabled: boolean;
  objectDetectionEnabled: boolean;
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
