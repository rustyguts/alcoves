import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/api", () => ({
  api: {
    libraries: {
      map: vi.fn(),
    },
  },
}));

import { useLibraryMap } from "~/composables/useLibraryMap";
import { api } from "~/api";
import type { LibraryMapResponse, MapPoint } from "~~/shared/types/api";

const mockMap = api.libraries.map as unknown as ReturnType<typeof vi.fn>;

function makePoint(id: string, over: Partial<MapPoint> = {}): MapPoint {
  return {
    id,
    name: id,
    lat: 37.78,
    lon: -122.4,
    thumbnailFileId: null,
    capturedAt: null,
    ...over,
  };
}

beforeEach(() => {
  mockMap.mockReset();
});

describe("useLibraryMap", () => {
  it("load populates points and truncated flag", async () => {
    mockMap.mockResolvedValueOnce({
      points: [makePoint("a"), makePoint("b")],
      truncated: true,
    } satisfies LibraryMapResponse);

    const m = useLibraryMap("lib-1");
    await m.load();

    expect(m.points.value.map((p) => p.id)).toEqual(["a", "b"]);
    expect(m.truncated.value).toBe(true);
    expect(mockMap).toHaveBeenCalledWith("lib-1");
  });

  it("captures error message on failed load", async () => {
    mockMap.mockRejectedValueOnce(new Error("nope"));

    const m = useLibraryMap("lib-1");
    await m.load();

    expect(m.error.value).toBe("nope");
    expect(m.points.value).toHaveLength(0);
  });
});
