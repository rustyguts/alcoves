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
  ownerId: string;
  createdAt: string;
  updatedAt: string;
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

export interface LibraryTag {
  id: string;
  libraryId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
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
