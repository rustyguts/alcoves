export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

export interface Library {
  id: string;
  name: string;
  isDefault: boolean;
  faceRecognitionEnabled: boolean;
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
  originalCreatedAt: string | null;
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

export interface LibraryMember {
  id: string;
  libraryId: string;
  userId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
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
  updatedAt: string;
}

export interface GlobalSearchResponse {
  query: string;
  totalCount: number;
  results: GlobalSearchResult[];
}
