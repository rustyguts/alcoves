import type { Route } from "@playwright/test";

export type Role = "owner" | "member" | "viewer";

export interface MockUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  createdAt?: string;
  updatedAt?: string;
}

export interface MockLibrary {
  id: string;
  name: string;
  emoji: string | null;
  isDefault: boolean;
  ownerId: string;
  currentUserRole?: Role | null;
  faceRecognitionEnabled: boolean;
  objectDetectionEnabled: boolean;
  sharingEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockTag {
  id: string;
  libraryId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockOwner {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface MockFolder {
  id: string;
  libraryId: string;
  parentFolderId: string | null;
  name: string;
  kind: "folder";
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: MockOwner | null;
  tags: MockTag[];
}

export interface MockFile {
  id: string;
  libraryId: string;
  parentFolderId: string | null;
  name: string;
  kind: "file";
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  thumbnailReady: boolean;
  posterUrl: string | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: MockOwner | null;
  tags: MockTag[];
  waveformStatus?: "queued" | "processing" | "ready" | "failed" | null;
  waveformPeaksPerSecond?: number;
  waveformPeaks?: number[];
}

export type MockEntry = MockFolder | MockFile;

export interface MockMember {
  id: string;
  userId: string;
  libraryId: string;
  role: Role;
  user: MockUser;
  createdAt: string;
}

export interface MockInvite {
  id: string;
  libraryId: string;
  role: Role;
  token: string;
  invitedEmail: string | null;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  canAccept?: boolean;
  invitedBy?: { displayName: string; avatarUrl: string | null };
  library?: { id: string; name: string };
}

export interface MockPerson {
  id: string;
  libraryId: string;
  name: string | null;
  faceCount: number;
  thumbnailVersion: number;
}

export interface MockObjectLabel {
  label: string;
  fileCount: number;
}

export interface MockAdminStats {
  users: number;
  libraries: number;
  files: number;
  folders: number;
  totalSize: number;
}

export interface MockAppSettings {
  registration_mode: "open" | "closed" | "invite_only";
  whisper_model?: string;
  whisper_language?: string;
  audio_detect_model?: string;
}

export interface MockQueue {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface MockJob {
  id: string;
  queueName: string;
  name: string;
  data: Record<string, unknown>;
  progress: number;
  attemptsMade: number;
  failedReason: string | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  state: "active" | "waiting" | "delayed" | "failed" | "completed";
}

export interface MockSession {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export type RouteHandler = (route: Route, url: URL) => Promise<boolean | void> | boolean | void;

export interface MockState {
  loggedIn: boolean;
  googleAuthEnabled: boolean;
  currentUser: MockUser;
  libraries: MockLibrary[];
  tags: MockTag[];
  folders: MockFolder[];
  files: MockFile[];
  members: MockMember[];
  invites: MockInvite[];
  adminUsers: MockUser[];
  adminStats: MockAdminStats;
  appSettings: MockAppSettings;
  queues: MockQueue[];
  jobs: MockJob[];
  people: MockPerson[];
  objectLabels: MockObjectLabel[];
  sessions: MockSession[];
  moments: MockMoment[];
  searchResults?: (query: string) => { query: string; totalCount: number; results: unknown[] };
  overrides: RouteHandler[];
}

export interface MockMoment {
  id: string;
  libraryId: string;
  fileId: string;
  createdById: string;
  name: string;
  description: string;
  startSeconds: number;
  endSeconds: number;
  exportStatus: string | null;
  exportProgress: number | null;
  exportEtaSeconds: number | null;
  exportVersion: number;
  exportedVersion: number | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: MockTag[];
}
