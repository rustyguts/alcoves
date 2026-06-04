import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, nextTick, type App } from "vue";
import { withSetup } from "../support/with-setup";
import { fnStub } from "../support/fn-stub";
import { useLibraryMoments } from "~/composables/useLibraryMoments";
import type { Moment } from "~~/shared/types/api";

const list = fnStub();
const create = fnStub();
const update = fnStub();
const del = fnStub();
const syncTags = fnStub();
const exportFn = fnStub();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: () => Promise.resolve(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: {
    moments: {
      list: (...a: unknown[]) => list(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      delete: (...a: unknown[]) => del(...a),
      syncTags: (...a: unknown[]) => syncTags(...a),
      export: (...a: unknown[]) => exportFn(...a),
    },
  },
}));

function makeMoment(over: Partial<Moment>): Moment {
  return {
    id: "m1",
    libraryId: "lib1",
    fileId: "file1",
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

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
});

function mount(libId = "lib1", fileId = "file1") {
  const { result, app: a } = withSetup(() => useLibraryMoments(ref(libId), ref(fileId)));
  app = a;
  return result;
}

const flush = async () => {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
};

describe("useLibraryMoments", () => {
  beforeEach(() => {
    [list, create, update, del, syncTags, exportFn].forEach((s) => s.reset());
  });

  it("refreshes immediately on mount", async () => {
    list.resolve([makeMoment({ id: "m1" })]);
    const { moments, loading } = mount();
    await flush();
    expect(list.calls[0]).toEqual(["lib1", "file1"]);
    expect(moments.value).toHaveLength(1);
    expect(loading.value).toBe(false);
  });

  it("skips refresh when the fileId is empty", async () => {
    list.resolve([]);
    mount("lib1", "");
    await flush();
    expect(list.calls).toHaveLength(0);
  });

  it("captures refresh errors", async () => {
    list.reject(new Error("boom"));
    const { error } = mount();
    await flush();
    expect(error.value).toBeInstanceOf(Error);
  });

  it("create() appends and keeps moments sorted by startSeconds", async () => {
    list.resolve([]);
    const { create: doCreate, moments } = mount();
    await flush();

    create.resolve(makeMoment({ id: "a", startSeconds: 5 }));
    await doCreate({ name: "a", startSeconds: 5, endSeconds: 6 });
    create.resolve(makeMoment({ id: "b", startSeconds: 1 }));
    await doCreate({ name: "b", startSeconds: 1, endSeconds: 2 });

    expect(create.calls[0]).toEqual(["lib1", "file1", { name: "a", startSeconds: 5, endSeconds: 6 }]);
    expect(moments.value.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("update() replaces the moment and re-sorts", async () => {
    list.resolve([makeMoment({ id: "a", startSeconds: 5 }), makeMoment({ id: "b", startSeconds: 1 })]);
    const { update: doUpdate, moments } = mount();
    await flush();

    update.resolve(makeMoment({ id: "a", startSeconds: 0 }));
    await doUpdate("a", { startSeconds: 0 });
    expect(update.calls[0]).toEqual(["lib1", "file1", "a", { startSeconds: 0 }]);
    expect(moments.value.map((m) => m.id)).toEqual(["a", "b"]);
    expect(moments.value.map((m) => m.startSeconds)).toEqual([0, 1]);
  });

  it("remove() filters out the deleted moment", async () => {
    list.resolve([makeMoment({ id: "a" }), makeMoment({ id: "b" })]);
    const { remove, moments } = mount();
    await flush();
    await remove("a");
    expect(del.calls[0]).toEqual(["lib1", "file1", "a"]);
    expect(moments.value.map((m) => m.id)).toEqual(["b"]);
  });

  it("syncTags() replaces the moment with the tagged version", async () => {
    list.resolve([makeMoment({ id: "a", name: "before" })]);
    const { syncTags: doSync, moments } = mount();
    await flush();
    syncTags.resolve(makeMoment({ id: "a", name: "after" }));
    await doSync("a", ["t1", "t2"]);
    expect(syncTags.calls[0]).toEqual(["lib1", "file1", "a", ["t1", "t2"]]);
    expect(moments.value[0]!.name).toBe("after");
  });

  it("triggerExport() swaps in the export-queued moment", async () => {
    list.resolve([makeMoment({ id: "a", exportStatus: null })]);
    const { triggerExport, moments } = mount();
    await flush();
    exportFn.resolve(makeMoment({ id: "a", exportStatus: "queued" }));
    await triggerExport("a");
    expect(exportFn.calls[0]).toEqual(["lib1", "file1", "a"]);
    expect(moments.value[0]!.exportStatus).toBe("queued");
  });

  it("reports hasInFlight while a moment is queued or processing", async () => {
    list.resolve([makeMoment({ id: "a", exportStatus: "processing" })]);
    const { hasInFlight } = mount();
    await flush();
    expect(hasInFlight.value).toBe(true);
  });

  describe("polling", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("polls while a moment is in flight and stops once it settles", async () => {
      list.resolve([makeMoment({ id: "a", exportStatus: "processing" })]);
      const { moments } = mount();
      await flush();
      expect(list.calls).toHaveLength(1);
      expect(moments.value[0]!.exportStatus).toBe("processing");

      // next poll returns a settled moment
      list.resolve([makeMoment({ id: "a", exportStatus: "ready" })]);
      vi.advanceTimersByTime(2000);
      await flush();
      expect(list.calls).toHaveLength(2);

      // now settled → polling stops
      vi.advanceTimersByTime(4000);
      await flush();
      expect(list.calls).toHaveLength(2);
    });

    it("stops polling when the component unmounts", async () => {
      list.resolve([makeMoment({ id: "a", exportStatus: "processing" })]);
      mount();
      await flush();
      expect(list.calls).toHaveLength(1);

      app?.unmount();
      app = undefined;
      vi.advanceTimersByTime(6000);
      await flush();
      expect(list.calls).toHaveLength(1);
    });
  });
});
