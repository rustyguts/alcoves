import type { Library, LibraryFile } from "./types";

let nextId = 100;
function genId(): string {
  return String(nextId++);
}

const libraries: Library[] = [
  {
    id: "1",
    name: "My Library",
    isDefault: true,
    createdAt: "2025-01-15T10:00:00Z",
    updatedAt: "2025-01-15T10:00:00Z",
  },
  {
    id: "2",
    name: "Design Assets",
    isDefault: false,
    createdAt: "2025-02-01T09:00:00Z",
    updatedAt: "2025-02-01T09:00:00Z",
  },
  {
    id: "3",
    name: "Engineering Docs",
    isDefault: false,
    createdAt: "2025-03-10T14:30:00Z",
    updatedAt: "2025-03-10T14:30:00Z",
  },
  {
    id: "4",
    name: "Marketing",
    isDefault: false,
    createdAt: "2025-04-05T08:00:00Z",
    updatedAt: "2025-04-05T08:00:00Z",
  },
];

const files: LibraryFile[] = [
  // My Library
  {
    id: "10",
    libraryId: "1",
    name: "Project Proposal.pdf",
    mimeType: "application/pdf",
    size: 2_450_000,
    createdAt: "2025-06-01T10:00:00Z",
    updatedAt: "2025-06-15T14:30:00Z",
  },
  {
    id: "11",
    libraryId: "1",
    name: "Meeting Notes.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 85_000,
    createdAt: "2025-06-10T09:00:00Z",
    updatedAt: "2025-07-01T11:00:00Z",
  },
  {
    id: "12",
    libraryId: "1",
    name: "Budget 2025.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 340_000,
    createdAt: "2025-05-20T08:00:00Z",
    updatedAt: "2025-06-30T16:00:00Z",
  },
  {
    id: "13",
    libraryId: "1",
    name: "Team Photo.jpg",
    mimeType: "image/jpeg",
    size: 4_200_000,
    createdAt: "2025-07-04T12:00:00Z",
    updatedAt: "2025-07-04T12:00:00Z",
  },
  {
    id: "14",
    libraryId: "1",
    name: "README.md",
    mimeType: "text/markdown",
    size: 3_200,
    createdAt: "2025-04-01T10:00:00Z",
    updatedAt: "2025-07-10T09:30:00Z",
  },
  {
    id: "15",
    libraryId: "1",
    name: "app-demo.mp4",
    mimeType: "video/mp4",
    size: 52_000_000,
    createdAt: "2025-07-12T15:00:00Z",
    updatedAt: "2025-07-12T15:00:00Z",
  },

  // Design Assets
  {
    id: "20",
    libraryId: "2",
    name: "Logo Final.svg",
    mimeType: "image/svg+xml",
    size: 12_000,
    createdAt: "2025-02-10T10:00:00Z",
    updatedAt: "2025-03-01T14:00:00Z",
  },
  {
    id: "21",
    libraryId: "2",
    name: "Brand Guidelines.pdf",
    mimeType: "application/pdf",
    size: 8_500_000,
    createdAt: "2025-02-15T09:00:00Z",
    updatedAt: "2025-04-20T11:00:00Z",
  },
  {
    id: "22",
    libraryId: "2",
    name: "Hero Banner.png",
    mimeType: "image/png",
    size: 1_800_000,
    createdAt: "2025-03-05T16:00:00Z",
    updatedAt: "2025-03-05T16:00:00Z",
  },
  {
    id: "23",
    libraryId: "2",
    name: "Icon Set.zip",
    mimeType: "application/zip",
    size: 5_600_000,
    createdAt: "2025-03-20T08:30:00Z",
    updatedAt: "2025-03-20T08:30:00Z",
  },
  {
    id: "24",
    libraryId: "2",
    name: "Mockup Homepage.fig",
    mimeType: "application/octet-stream",
    size: 15_000_000,
    createdAt: "2025-04-01T10:00:00Z",
    updatedAt: "2025-05-15T14:00:00Z",
  },

  // Engineering Docs
  {
    id: "30",
    libraryId: "3",
    name: "Architecture Overview.md",
    mimeType: "text/markdown",
    size: 18_000,
    createdAt: "2025-03-15T10:00:00Z",
    updatedAt: "2025-06-01T09:00:00Z",
  },
  {
    id: "31",
    libraryId: "3",
    name: "API Reference.pdf",
    mimeType: "application/pdf",
    size: 1_200_000,
    createdAt: "2025-03-20T14:00:00Z",
    updatedAt: "2025-05-10T11:00:00Z",
  },
  {
    id: "32",
    libraryId: "3",
    name: "Database Schema.sql",
    mimeType: "text/plain",
    size: 45_000,
    createdAt: "2025-04-01T08:00:00Z",
    updatedAt: "2025-06-20T16:30:00Z",
  },
  {
    id: "33",
    libraryId: "3",
    name: "deploy-config.yaml",
    mimeType: "text/yaml",
    size: 2_800,
    createdAt: "2025-04-10T12:00:00Z",
    updatedAt: "2025-07-01T10:00:00Z",
  },
  {
    id: "34",
    libraryId: "3",
    name: "test-results.json",
    mimeType: "application/json",
    size: 156_000,
    createdAt: "2025-05-01T09:00:00Z",
    updatedAt: "2025-07-15T08:00:00Z",
  },

  // Marketing
  {
    id: "40",
    libraryId: "4",
    name: "Q3 Campaign Brief.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 125_000,
    createdAt: "2025-04-10T10:00:00Z",
    updatedAt: "2025-05-01T14:00:00Z",
  },
  {
    id: "41",
    libraryId: "4",
    name: "Social Media Calendar.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 280_000,
    createdAt: "2025-04-15T09:00:00Z",
    updatedAt: "2025-06-30T11:00:00Z",
  },
  {
    id: "42",
    libraryId: "4",
    name: "Product Launch Video.mp4",
    mimeType: "video/mp4",
    size: 98_000_000,
    createdAt: "2025-05-20T15:00:00Z",
    updatedAt: "2025-05-20T15:00:00Z",
  },
  {
    id: "43",
    libraryId: "4",
    name: "Press Release.pdf",
    mimeType: "application/pdf",
    size: 450_000,
    createdAt: "2025-06-01T08:00:00Z",
    updatedAt: "2025-06-15T10:30:00Z",
  },
  {
    id: "44",
    libraryId: "4",
    name: "podcast-episode-12.mp3",
    mimeType: "audio/mpeg",
    size: 35_000_000,
    createdAt: "2025-06-10T14:00:00Z",
    updatedAt: "2025-06-10T14:00:00Z",
  },
];

export function getLibraries(): Library[] {
  return libraries;
}

export function getLibrary(id: string): Library | undefined {
  return libraries.find((l) => l.id === id);
}

export function createLibrary(name: string): Library {
  const library: Library = {
    id: genId(),
    name,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  libraries.push(library);
  return library;
}

export function renameLibrary(id: string, name: string): Library | undefined {
  const library = libraries.find((l) => l.id === id);
  if (!library) return undefined;
  library.name = name;
  library.updatedAt = new Date().toISOString();
  return library;
}

export function getFiles(libraryId: string): LibraryFile[] {
  return files.filter((f) => f.libraryId === libraryId);
}

export function addFile(
  libraryId: string,
  name: string,
  mimeType: string,
  size: number,
): LibraryFile {
  const file: LibraryFile = {
    id: genId(),
    libraryId,
    name,
    mimeType,
    size,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  files.push(file);
  return file;
}

export function renameFile(fileId: string, name: string): LibraryFile | undefined {
  const file = files.find((f) => f.id === fileId);
  if (!file) return undefined;
  file.name = name;
  file.updatedAt = new Date().toISOString();
  return file;
}

export function deleteFiles(fileIds: string[]): number {
  const idSet = new Set(fileIds);
  let deleted = 0;
  for (let i = files.length - 1; i >= 0; i--) {
    if (idSet.has(files[i].id)) {
      files.splice(i, 1);
      deleted++;
    }
  }
  return deleted;
}
