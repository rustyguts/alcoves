import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useMomentDownloads } from "~/composables/useMomentDownloads";
import type { Moment } from "~~/shared/types/api";

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: vi.fn(),
  apiUrl: (path: string) => path,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: {
    moments: {
      downloadUrl: (libId: string, fileId: string, momentId: string) =>
        `/api/libraries/${libId}/files/${fileId}/moments/${momentId}/download`,
    },
  },
}));

const toastAdd = vi.fn();
vi.mock("~/composables/useToast", () => ({
  useToast: () => ({ add: toastAdd }),
}));

function makeMoment(over: Partial<Moment>): Moment {
  return {
    id: "m1",
    libraryId: "lib-1",
    fileId: "file-1",
    createdById: "u",
    name: "n",
    description: "d",
    startSeconds: 0,
    endSeconds: 1,
    exportStatus: null,
    exportProgress: null,
    exportEtaSeconds: null,
    exportVersion: 1,
    exportedVersion: null,
    trashedAt: null,
    createdAt: "",
    updatedAt: "",
    tags: [],
    ...over,
  } as Moment;
}

describe("useMomentDownloads", () => {
  beforeEach(() => {
    toastAdd.mockReset();
    // jsdom navigation throws — neutralize it for the duration of the test.
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: { href: "" },
    });
  });

  it("redirects immediately when the moment export is fresh", async () => {
    const moments = ref<Moment[]>([
      makeMoment({ id: "m1", exportStatus: "ready", exportVersion: 1, exportedVersion: 1 }),
    ]);
    const triggerExport = vi.fn();
    const { request, isPending } = useMomentDownloads(
      ref("lib-1"),
      ref("file-1"),
      moments,
      triggerExport,
    );
    await request("m1");
    expect(window.location.href).toContain("/moments/m1/download");
    expect(triggerExport).not.toHaveBeenCalled();
    expect(isPending("m1")).toBe(false);
  });

  it("queues the moment + triggers export when the export is stale", async () => {
    const moments = ref<Moment[]>([
      makeMoment({ id: "m1", exportStatus: null, exportVersion: 2, exportedVersion: 1 }),
    ]);
    const triggerExport = vi.fn().mockResolvedValue(undefined);
    const { request, isPending } = useMomentDownloads(
      ref("lib-1"),
      ref("file-1"),
      moments,
      triggerExport,
    );
    await request("m1");
    expect(triggerExport).toHaveBeenCalledWith("m1");
    expect(isPending("m1")).toBe(true);
    expect(window.location.href).toBe("");
  });

  it("redirects once the watched moment becomes ready", async () => {
    const moments = ref<Moment[]>([
      makeMoment({ id: "m1", exportStatus: "processing", exportVersion: 2, exportedVersion: 1 }),
    ]);
    const triggerExport = vi.fn().mockResolvedValue(undefined);
    const { request, isPending } = useMomentDownloads(
      ref("lib-1"),
      ref("file-1"),
      moments,
      triggerExport,
    );
    await request("m1");
    expect(isPending("m1")).toBe(true);

    moments.value = [
      makeMoment({ id: "m1", exportStatus: "ready", exportVersion: 2, exportedVersion: 2 }),
    ];
    await Promise.resolve();
    await Promise.resolve();
    expect(window.location.href).toContain("/moments/m1/download");
    expect(isPending("m1")).toBe(false);
  });

  it("clears pending + toasts on export failure", async () => {
    const moments = ref<Moment[]>([
      makeMoment({ id: "m1", exportStatus: "processing", exportVersion: 2, exportedVersion: 1 }),
    ]);
    const triggerExport = vi.fn().mockResolvedValue(undefined);
    const { request, isPending } = useMomentDownloads(
      ref("lib-1"),
      ref("file-1"),
      moments,
      triggerExport,
    );
    await request("m1");
    moments.value = [
      makeMoment({ id: "m1", exportStatus: "failed", exportVersion: 2, exportedVersion: 1 }),
    ];
    await Promise.resolve();
    await Promise.resolve();
    expect(isPending("m1")).toBe(false);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Export failed", color: "error" }),
    );
  });
});
