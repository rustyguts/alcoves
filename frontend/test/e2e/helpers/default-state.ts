import type {
  MockFile,
  MockFolder,
  MockInvite,
  MockLibrary,
  MockMember,
  MockPerson,
  MockState,
  MockTag,
  MockUser,
} from "./types";

const TIMESTAMP = "2026-01-15T12:00:00.000Z";

const owner: MockUser = {
  id: "user-owner",
  email: "owner@example.com",
  displayName: "Alex Owner",
  avatarUrl: null,
  role: "owner",
  createdAt: "2025-06-01T10:00:00.000Z",
  updatedAt: TIMESTAMP,
};

const libraries: MockLibrary[] = [
  {
    id: "lib-personal",
    name: "Personal",
    emoji: "🏠",
    isDefault: true,
    ownerId: owner.id,
    currentUserRole: "owner",
    faceRecognitionEnabled: false,
    objectDetectionEnabled: false,
    sharingEnabled: false,
    createdAt: "2025-06-01T10:00:00.000Z",
    updatedAt: TIMESTAMP,
  },
  {
    id: "lib-photos",
    name: "Photos 2025",
    emoji: "📸",
    isDefault: false,
    ownerId: owner.id,
    currentUserRole: "owner",
    faceRecognitionEnabled: true,
    objectDetectionEnabled: true,
    sharingEnabled: true,
    createdAt: "2025-07-01T10:00:00.000Z",
    updatedAt: TIMESTAMP,
  },
  {
    id: "lib-team",
    name: "Shared Team Library",
    emoji: null,
    isDefault: false,
    ownerId: owner.id,
    currentUserRole: "owner",
    faceRecognitionEnabled: false,
    objectDetectionEnabled: false,
    sharingEnabled: false,
    createdAt: "2025-08-01T10:00:00.000Z",
    updatedAt: TIMESTAMP,
  },
];

const tagPalette = [
  "#E11D48",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#64748B",
  "#0EA5E9",
];

const tagNames = ["Important", "Archive", "Family", "Travel", "Work", "Draft", "Shared", "Starred"];

const tags: MockTag[] = tagNames.map((name, i) => ({
  id: `tag-${i + 1}`,
  libraryId: "lib-photos",
  name,
  color: tagPalette[i] ?? "#64748B",
  createdAt: "2025-09-01T00:00:00.000Z",
  updatedAt: TIMESTAMP,
}));

const ownerRef = { id: owner.id, displayName: owner.displayName, avatarUrl: owner.avatarUrl };

const folders: MockFolder[] = [
  {
    id: "folder-vacation",
    libraryId: "lib-photos",
    parentFolderId: null,
    name: "Vacation 2025",
    kind: "folder",
    trashedAt: null,
    createdAt: "2025-07-15T00:00:00.000Z",
    updatedAt: TIMESTAMP,
    owner: ownerRef,
    tags: [tags[3]!],
  },
  {
    id: "folder-family",
    libraryId: "lib-photos",
    parentFolderId: null,
    name: "Family",
    kind: "folder",
    trashedAt: null,
    createdAt: "2025-07-16T00:00:00.000Z",
    updatedAt: TIMESTAMP,
    owner: ownerRef,
    tags: [tags[2]!],
  },
  {
    id: "folder-receipts",
    libraryId: "lib-personal",
    parentFolderId: null,
    name: "Receipts",
    kind: "folder",
    trashedAt: null,
    createdAt: "2025-07-17T00:00:00.000Z",
    updatedAt: TIMESTAMP,
    owner: ownerRef,
    tags: [],
  },
  {
    id: "folder-projects",
    libraryId: "lib-personal",
    parentFolderId: null,
    name: "Projects",
    kind: "folder",
    trashedAt: null,
    createdAt: "2025-07-18T00:00:00.000Z",
    updatedAt: TIMESTAMP,
    owner: ownerRef,
    tags: [],
  },
  {
    id: "folder-trashed",
    libraryId: "lib-photos",
    parentFolderId: null,
    name: "Old Drafts",
    kind: "folder",
    trashedAt: "2025-12-20T00:00:00.000Z",
    updatedAt: TIMESTAMP,
    owner: ownerRef,
    tags: [],
    createdAt: "2025-06-05T00:00:00.000Z",
  },
];

function makeFile(
  id: string,
  name: string,
  mimeType: string,
  size: number,
  opts: Partial<MockFile> = {},
): MockFile {
  return {
    id,
    libraryId: "lib-photos",
    parentFolderId: null,
    name,
    kind: "file",
    mimeType,
    size,
    width: null,
    height: null,
    thumbnailReady: true,
    posterUrl: null,
    trashedAt: null,
    createdAt: "2025-10-01T00:00:00.000Z",
    updatedAt: TIMESTAMP,
    owner: ownerRef,
    tags: [],
    ...opts,
  };
}

const files: MockFile[] = [
  makeFile("file-img-1", "sunset.jpg", "image/jpeg", 2_457_600, {
    width: 4000,
    height: 3000,
    tags: [tags[3]!, tags[7]!],
  }),
  makeFile("file-img-2", "portrait.png", "image/png", 1_234_560, {
    width: 2000,
    height: 3000,
  }),
  makeFile("file-img-3", "landscape.jpg", "image/jpeg", 3_145_728, {
    width: 4096,
    height: 2160,
    tags: [tags[3]!],
  }),
  makeFile("file-img-4", "family-dinner.heic", "image/heic", 4_718_592, {
    tags: [tags[2]!],
  }),
  makeFile("file-img-5", "snapshot.jpg", "image/jpeg", 987_654, { thumbnailReady: false }),
  makeFile("file-vid-1", "road-trip.mp4", "video/mp4", 52_428_800, {
    width: 1920,
    height: 1080,
    posterUrl: "/poster/road-trip.jpg",
  }),
  makeFile("file-vid-2", "birthday.mov", "video/quicktime", 31_457_280, {
    width: 1280,
    height: 720,
  }),
  makeFile("file-vid-3", "drone-flight.mp4", "video/mp4", 104_857_600, {
    width: 3840,
    height: 2160,
    thumbnailReady: false,
  }),
  makeFile("file-doc-1", "Quarterly Plan.pdf", "application/pdf", 245_760),
  makeFile(
    "file-doc-2",
    "notes.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    122_880,
  ),
  makeFile("file-audio-1", "voice-memo.mp3", "audio/mpeg", 4_194_304),
  makeFile("file-audio-2", "interview.wav", "audio/wav", 18_874_368),
];

const members: MockMember[] = [
  {
    id: "member-1",
    userId: owner.id,
    libraryId: "lib-photos",
    role: "owner",
    user: owner,
    createdAt: TIMESTAMP,
  },
  {
    id: "member-2",
    userId: "user-editor-1",
    libraryId: "lib-photos",
    role: "member",
    user: {
      id: "user-editor-1",
      email: "morgan@example.com",
      displayName: "Morgan Editor",
      avatarUrl: null,
      role: "member",
    },
    createdAt: TIMESTAMP,
  },
  {
    id: "member-3",
    userId: "user-editor-2",
    libraryId: "lib-photos",
    role: "member",
    user: {
      id: "user-editor-2",
      email: "sam@example.com",
      displayName: "Sam Editor",
      avatarUrl: null,
      role: "member",
    },
    createdAt: TIMESTAMP,
  },
  {
    id: "member-4",
    userId: "user-viewer-1",
    libraryId: "lib-photos",
    role: "viewer",
    user: {
      id: "user-viewer-1",
      email: "jamie@example.com",
      displayName: "Jamie Viewer",
      avatarUrl: null,
      role: "viewer",
    },
    createdAt: TIMESTAMP,
  },
  {
    id: "member-5",
    userId: "user-viewer-2",
    libraryId: "lib-photos",
    role: "viewer",
    user: {
      id: "user-viewer-2",
      email: "taylor@example.com",
      displayName: "Taylor Viewer",
      avatarUrl: null,
      role: "viewer",
    },
    createdAt: TIMESTAMP,
  },
];

const invites: MockInvite[] = [
  {
    id: "invite-pending",
    libraryId: "lib-photos",
    role: "member",
    token: "test-token",
    invitedEmail: null,
    createdAt: "2026-01-10T00:00:00.000Z",
    expiresAt: "2026-02-10T00:00:00.000Z",
    status: "pending",
    canAccept: true,
    invitedBy: { displayName: owner.displayName, avatarUrl: null },
    library: { id: "lib-photos", name: "Photos 2025" },
  },
  {
    id: "invite-scoped",
    libraryId: "lib-photos",
    role: "viewer",
    token: "scoped-token",
    invitedEmail: "friend@example.com",
    createdAt: "2026-01-11T00:00:00.000Z",
    expiresAt: "2026-02-11T00:00:00.000Z",
    status: "pending",
  },
  {
    id: "invite-revoked",
    libraryId: "lib-photos",
    role: "viewer",
    token: "revoked-token",
    invitedEmail: null,
    createdAt: "2026-01-05T00:00:00.000Z",
    expiresAt: "2026-02-05T00:00:00.000Z",
    status: "revoked",
    canAccept: false,
    invitedBy: { displayName: owner.displayName, avatarUrl: null },
    library: { id: "lib-photos", name: "Photos 2025" },
  },
];

const people: MockPerson[] = [
  {
    id: "person-1",
    libraryId: "lib-photos",
    name: "Alex Owner",
    faceCount: 48,
    thumbnailVersion: 1,
  },
  {
    id: "person-2",
    libraryId: "lib-photos",
    name: "Morgan Editor",
    faceCount: 23,
    thumbnailVersion: 1,
  },
  {
    id: "person-3",
    libraryId: "lib-photos",
    name: null,
    faceCount: 11,
    thumbnailVersion: 1,
  },
  {
    id: "person-4",
    libraryId: "lib-photos",
    name: null,
    faceCount: 5,
    thumbnailVersion: 1,
  },
];

const adminUsers: MockUser[] = [
  owner,
  {
    id: "user-2",
    email: "morgan@example.com",
    displayName: "Morgan Member",
    avatarUrl: null,
    role: "member",
    createdAt: "2025-08-15T10:00:00.000Z",
    updatedAt: TIMESTAMP,
  },
  {
    id: "user-3",
    email: "jamie@example.com",
    displayName: "Jamie Viewer",
    avatarUrl: null,
    role: "viewer",
    createdAt: "2025-09-20T10:00:00.000Z",
    updatedAt: TIMESTAMP,
  },
];

function makeSearchResults(query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || trimmed.length < 2) return { query, totalCount: 0, results: [] };

  if (trimmed.includes("plan")) {
    return {
      query,
      totalCount: 1,
      results: [
        {
          id: "file-doc-1",
          kind: "file",
          name: "Quarterly Plan.pdf",
          mimeType: "application/pdf",
          size: 245_760,
          updatedAt: TIMESTAMP,
          libraryId: "lib-photos",
          libraryName: "Photos 2025",
          locationPath: "Root/Planning",
          targetFolderId: "folder-planning",
        },
      ],
    };
  }

  if (trimmed.includes("folder")) {
    return {
      query,
      totalCount: 1,
      results: [
        {
          id: "folder-vacation",
          kind: "folder",
          name: "Project Folder",
          mimeType: null,
          size: null,
          updatedAt: TIMESTAMP,
          libraryId: "lib-personal",
          libraryName: "Personal",
          locationPath: "Root",
          targetFolderId: "folder-vacation",
        },
      ],
    };
  }

  if (trimmed.includes("mix")) {
    return {
      query,
      totalCount: 6,
      results: [
        {
          id: "file-img-1",
          kind: "file",
          name: "sunset.jpg",
          mimeType: "image/jpeg",
          size: 2_457_600,
          updatedAt: TIMESTAMP,
          libraryId: "lib-photos",
          libraryName: "Photos 2025",
          locationPath: "Root/Vacation 2025",
          targetFolderId: "folder-vacation",
        },
        {
          id: "file-vid-1",
          kind: "file",
          name: "road-trip.mp4",
          mimeType: "video/mp4",
          size: 52_428_800,
          updatedAt: TIMESTAMP,
          libraryId: "lib-photos",
          libraryName: "Photos 2025",
          locationPath: "Root/Vacation 2025",
          targetFolderId: "folder-vacation",
        },
        {
          id: "folder-family",
          kind: "folder",
          name: "Family",
          mimeType: null,
          size: null,
          updatedAt: TIMESTAMP,
          libraryId: "lib-photos",
          libraryName: "Photos 2025",
          locationPath: "Root",
          targetFolderId: "folder-family",
        },
        {
          id: "file-doc-1",
          kind: "file",
          name: "Quarterly Plan.pdf",
          mimeType: "application/pdf",
          size: 245_760,
          updatedAt: TIMESTAMP,
          libraryId: "lib-personal",
          libraryName: "Personal",
          locationPath: "Root",
          targetFolderId: null,
        },
        {
          id: "folder-receipts",
          kind: "folder",
          name: "Receipts",
          mimeType: null,
          size: null,
          updatedAt: TIMESTAMP,
          libraryId: "lib-personal",
          libraryName: "Personal",
          locationPath: "Root",
          targetFolderId: "folder-receipts",
        },
        {
          id: "file-audio-1",
          kind: "file",
          name: "voice-memo.mp3",
          mimeType: "audio/mpeg",
          size: 4_194_304,
          updatedAt: TIMESTAMP,
          libraryId: "lib-personal",
          libraryName: "Personal",
          locationPath: "Root",
          targetFolderId: null,
        },
      ],
    };
  }

  return { query, totalCount: 0, results: [] };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> | T[K] : T[K];
};

export function createDefaultState(overrides: DeepPartial<MockState> = {}): MockState {
  const base: MockState = {
    loggedIn: true,
    googleAuthEnabled: false,
    registrationMode: "open",
    currentUser: { ...owner },
    libraries: libraries.map((l) => ({ ...l })),
    tags: tags.map((t) => ({ ...t })),
    folders: folders.map((f) => ({ ...f, tags: [...f.tags] })),
    files: files.map((f) => ({ ...f, tags: [...f.tags] })),
    members: members.map((m) => ({ ...m, user: { ...m.user } })),
    invites: invites.map((i) => ({ ...i })),
    adminUsers: adminUsers.map((u) => ({ ...u })),
    adminStats: { users: 5, libraries: 3, files: 42, folders: 12, totalSize: 1_073_741_824 },
    appSettings: {
      registration_mode: "open",
      whisper_model: "medium",
      whisper_language: "auto",
      audio_detect_model: "efficientat_mn10",
    },
    queues: [
      { name: "{transcode}", waiting: 2, active: 1, completed: 48, failed: 1, delayed: 0 },
      { name: "{thumbnail}", waiting: 0, active: 0, completed: 120, failed: 0, delayed: 0 },
      { name: "{object-detect}", waiting: 3, active: 2, completed: 64, failed: 2, delayed: 1 },
    ],
    jobs: [
      {
        id: "job-1",
        queueName: "{transcode}",
        name: "transcode-video",
        data: { fileId: "file-vid-1" },
        progress: 42,
        attemptsMade: 1,
        failedReason: null,
        timestamp: 1736947200000,
        processedOn: 1736947205000,
        finishedOn: null,
        state: "active",
      },
      {
        id: "job-2",
        queueName: "{object-detect}",
        name: "detect-objects",
        data: { fileId: "file-img-1" },
        progress: 75,
        attemptsMade: 1,
        failedReason: null,
        timestamp: 1736947100000,
        processedOn: 1736947110000,
        finishedOn: null,
        state: "active",
      },
      {
        id: "job-3",
        queueName: "{object-detect}",
        name: "detect-objects",
        data: { fileId: "file-img-2" },
        progress: 0,
        attemptsMade: 0,
        failedReason: null,
        timestamp: 1736947000000,
        processedOn: null,
        finishedOn: null,
        state: "waiting",
      },
      {
        id: "job-4",
        queueName: "{transcode}",
        name: "transcode-video",
        data: { fileId: "file-vid-3" },
        progress: 0,
        attemptsMade: 3,
        failedReason: "ffmpeg exited with code 1",
        timestamp: 1736946000000,
        processedOn: 1736946100000,
        finishedOn: 1736946200000,
        state: "failed",
      },
      {
        id: "job-5",
        queueName: "{object-detect}",
        name: "detect-objects",
        data: { fileId: "file-img-5" },
        progress: 0,
        attemptsMade: 2,
        failedReason: "ONNX runtime error: tensor shape mismatch",
        timestamp: 1736945000000,
        processedOn: 1736945100000,
        finishedOn: 1736945200000,
        state: "failed",
      },
      {
        id: "job-6",
        queueName: "{object-detect}",
        name: "detect-objects",
        data: { fileId: "file-img-3" },
        progress: 0,
        attemptsMade: 0,
        failedReason: null,
        timestamp: 1736944000000,
        processedOn: null,
        finishedOn: null,
        state: "delayed",
      },
    ],
    people: people.map((p) => ({ ...p })),
    objectLabels: [
      { label: "person", fileCount: 32 },
      { label: "dog", fileCount: 14 },
      { label: "cat", fileCount: 9 },
      { label: "car", fileCount: 18 },
      { label: "tree", fileCount: 22 },
      { label: "mountain", fileCount: 7 },
      { label: "beach", fileCount: 11 },
      { label: "food", fileCount: 15 },
    ],
    sessions: [
      {
        id: "session-current",
        userAgent: "Mozilla/5.0 Chrome/120",
        ipAddress: "192.168.1.20",
        createdAt: "2026-01-14T09:00:00.000Z",
        expiresAt: "2026-02-14T09:00:00.000Z",
        isCurrent: true,
      },
      {
        id: "session-other",
        userAgent: "Mozilla/5.0 Firefox/120",
        ipAddress: "10.0.0.5",
        createdAt: "2026-01-10T09:00:00.000Z",
        expiresAt: "2026-02-10T09:00:00.000Z",
        isCurrent: false,
      },
    ],
    accessTokens: [
      {
        id: "token-laptop",
        name: "Claude Desktop (laptop)",
        lastUsedAt: "2026-01-14T08:30:00.000Z",
        expiresAt: null,
        createdAt: "2026-01-02T09:00:00.000Z",
      },
    ],
    moments: [],
    searchResults: makeSearchResults,
    overrides: [],
  };

  return Object.assign(base, overrides) as MockState;
}
