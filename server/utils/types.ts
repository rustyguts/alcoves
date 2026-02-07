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
  name: string;
  mimeType: string;
  size: number;
  originalCreatedAt: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: LibraryTag[];
}

export interface PaginatedFiles {
  files: LibraryFile[];
  nextCursor: string | null;
  totalCount: number;
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
