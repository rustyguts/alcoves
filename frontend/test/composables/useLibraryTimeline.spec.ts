import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/api", () => ({
  api: {
    libraries: {
      timeline: vi.fn(),
    },
  },
}));

import { useLibraryTimeline } from "~/composables/useLibraryTimeline";
import { api } from "~/api";
import type { LibraryFile, LibraryFolder, PaginatedFiles } from "~~/shared/types/api";

const mockTimeline = api.libraries.timeline as unknown as ReturnType<typeof vi.fn>;

function makeFile(id: string, over: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id,
    libraryId: "lib-1",
    parentFolderId: null,
    name: id,
    mimeType: "image/jpeg",
    size: 1,
    kind: "file",
    duration: null,
    width: null,
    height: null,
    proxyStatus: null,
    thumbnailFileId: null,
    sourceFileId: null,
    originalCreatedAt: null,
    capturedAt: null,
    hash: null,
    trashedAt: null,
    createdAt: "2026-01-01T12:00:00Z",
    updatedAt: "2026-01-01T12:00:00Z",
    owner: null,
    tags: [],
    ...over,
  };
}

function makeFolder(id: string): LibraryFolder {
  return {
    id,
    libraryId: "lib-1",
    parentFolderId: null,
    name: id,
    kind: "folder",
    trashedAt: null,
    createdAt: "2026-01-01T12:00:00Z",
    updatedAt: "2026-01-01T12:00:00Z",
    owner: null,
    tags: [],
  };
}

function page(entries: (LibraryFile | LibraryFolder)[], nextCursor: string | null, total = entries.length): PaginatedFiles {
  return { entries, nextCursor, totalCount: total, breadcrumbs: [], currentFolderId: null };
}

beforeEach(() => {
  mockTimeline.mockReset();
});

describe("useLibraryTimeline", () => {
  it("loadFirst fetches with type=media and populates files + total", async () => {
    mockTimeline.mockResolvedValueOnce(page([makeFile("a"), makeFile("b")], "c1", 2));

    const tl = useLibraryTimeline("lib-1");
    await tl.loadFirst();

    expect(tl.entries.value.map((f) => f.id)).toEqual(["a", "b"]);
    expect(tl.nextCursor.value).toBe("c1");
    expect(tl.totalCount.value).toBe(2);
    expect(mockTimeline).toHaveBeenCalledWith("lib-1", { type: "media" });
  });

  it("filters out folder entries (timeline is files-only)", async () => {
    mockTimeline.mockResolvedValueOnce(page([makeFolder("dir"), makeFile("a")], null, 1));

    const tl = useLibraryTimeline("lib-1");
    await tl.loadFirst();

    expect(tl.entries.value.map((f) => f.id)).toEqual(["a"]);
  });

  it("loadMore appends and forwards the cursor + current type", async () => {
    mockTimeline
      .mockResolvedValueOnce(page([makeFile("a")], "c1"))
      .mockResolvedValueOnce(page([makeFile("b")], null));

    const tl = useLibraryTimeline("lib-1");
    await tl.loadFirst();
    await tl.loadMore();

    expect(mockTimeline).toHaveBeenLastCalledWith("lib-1", { type: "media", cursor: "c1" });
    expect(tl.entries.value.map((f) => f.id)).toEqual(["a", "b"]);
    expect(tl.nextCursor.value).toBeNull();
  });

  it("groups entries into day buckets by capturedAt", async () => {
    mockTimeline.mockResolvedValueOnce(
      page(
        [
          makeFile("a", { capturedAt: "2026-06-04T10:00:00Z" }),
          makeFile("b", { capturedAt: "2026-06-04T18:00:00Z" }),
          makeFile("c", { capturedAt: "2026-06-01T09:00:00Z" }),
        ],
        null,
        3,
      ),
    );

    const tl = useLibraryTimeline("lib-1");
    await tl.loadFirst();

    expect(tl.groups.value).toHaveLength(2);
    expect(tl.groups.value[0]!.files.map((f) => f.id)).toEqual(["a", "b"]);
    expect(tl.groups.value[1]!.files.map((f) => f.id)).toEqual(["c"]);
  });

  it("setType switches filter and refetches", async () => {
    mockTimeline
      .mockResolvedValueOnce(page([makeFile("a")], null))
      .mockResolvedValueOnce(page([makeFile("a"), makeFolder("d")], null, 2));

    const tl = useLibraryTimeline("lib-1");
    await tl.loadFirst();
    tl.setType("all");
    await Promise.resolve();
    await Promise.resolve();

    expect(tl.typeFilter.value).toBe("all");
    expect(mockTimeline).toHaveBeenLastCalledWith("lib-1", { type: "all" });
  });

  it("captures error message on failed load", async () => {
    mockTimeline.mockRejectedValueOnce(new Error("boom"));

    const tl = useLibraryTimeline("lib-1");
    await tl.loadFirst();

    expect(tl.error.value).toBe("boom");
    expect(tl.entries.value).toHaveLength(0);
  });
});
