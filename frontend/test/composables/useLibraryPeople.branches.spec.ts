import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { fnStub } from "../support/fn-stub";
import { useLibraryPeople } from "~/composables/useLibraryPeople";
import type { LibraryPerson } from "~~/shared/types/api";

const list = fnStub();
const update = fnStub();
const merge = fnStub();
const listFaces = fnStub();
const splitFace = fnStub();
const toastAdd = vi.fn();

vi.mock("~/utils/api-fetch", () => ({
  apiFetch: () => Promise.resolve(),
  apiUrl: (p: string) => p,
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/api", () => ({
  api: {
    people: {
      list: (...a: unknown[]) => list(...a),
      update: (...a: unknown[]) => update(...a),
      merge: (...a: unknown[]) => merge(...a),
      listFaces: (...a: unknown[]) => listFaces(...a),
      splitFace: (...a: unknown[]) => splitFace(...a),
      thumbnailUrl: (lib: string, id: string, v?: string) => `/thumb/${id}?v=${v}`,
    },
  },
}));

vi.mock("~/composables/useToast", () => ({ useToast: () => ({ add: toastAdd }) }));

function makePerson(over: Partial<LibraryPerson> & { id: string }): LibraryPerson {
  return {
    id: over.id,
    libraryId: "lib1",
    name: "Unknown",
    faceCount: 1,
    coverFaceDetectionId: "face-1",
    createdAt: "",
    updatedAt: "2025-01-01",
    ...over,
  };
}

beforeEach(() => {
  [list, update, merge, listFaces, splitFace].forEach((s) => s.reset());
  toastAdd.mockReset();
});

describe("useLibraryPeople branches", () => {
  it("toasts when fetching people fails", async () => {
    list.reject(new Error("boom"));
    const p = useLibraryPeople(ref("lib1"));
    await p.fetchPeople();
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to load people", color: "error" });
    expect(p.loading.value).toBe(false);
  });

  it("toasts when renaming a person fails", async () => {
    update.reject(new Error("boom"));
    const p = useLibraryPeople(ref("lib1"));
    await p.renamePerson("p1", "New");
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to rename person", color: "error" });
  });

  it("toggles person selection on and off", () => {
    const p = useLibraryPeople(ref("lib1"));
    p.togglePersonSelection("p1");
    expect(p.selectedPeople.has("p1")).toBe(true);
    p.togglePersonSelection("p1");
    expect(p.selectedPeople.has("p1")).toBe(false);
  });

  it("does nothing when merging fewer than two people", async () => {
    const p = useLibraryPeople(ref("lib1"));
    p.togglePersonSelection("p1");
    await p.mergePeople();
    expect(merge.calls).toHaveLength(0);
  });

  it("merges selected people then clears and refetches", async () => {
    merge.resolve(undefined);
    list.resolve([]);
    const p = useLibraryPeople(ref("lib1"));
    p.togglePersonSelection("p1");
    p.togglePersonSelection("p2");
    await p.mergePeople();
    expect(merge.calls[0]).toEqual(["lib1", { personIds: ["p1", "p2"] }]);
    expect(p.selectedPeople.size).toBe(0);
    expect(toastAdd).toHaveBeenCalledWith({ title: "People merged" });
  });

  it("toasts when merging fails", async () => {
    merge.reject(new Error("boom"));
    const p = useLibraryPeople(ref("lib1"));
    p.togglePersonSelection("p1");
    p.togglePersonSelection("p2");
    await p.mergePeople();
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to merge people", color: "error" });
  });

  it("toasts when loading faces fails", async () => {
    listFaces.reject(new Error("boom"));
    const p = useLibraryPeople(ref("lib1"));
    await p.loadPersonFaces(makePerson({ id: "p1" }));
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to load faces", color: "error" });
    expect(p.loadingFaces.value).toBe(false);
  });

  it("toasts when setting the cover photo fails", async () => {
    update.reject(new Error("boom"));
    const p = useLibraryPeople(ref("lib1"));
    await p.setPersonCover("p1", "face-9");
    expect(toastAdd).toHaveBeenCalledWith({ title: "Failed to update cover photo", color: "error" });
    expect(p.updatingCoverFaceId.value).toBeNull();
  });

  it("builds a thumbnail URL keyed on the cover face id", () => {
    const p = useLibraryPeople(ref("lib1"));
    expect(p.getPersonThumbnailUrl(makePerson({ id: "p1", coverFaceDetectionId: "c9" }))).toBe(
      "/thumb/p1?v=c9",
    );
  });

  it("closes the detail view if the split person no longer exists", async () => {
    splitFace.resolve(undefined);
    list.resolve([]); // person gone after split
    const p = useLibraryPeople(ref("lib1"));
    p.activePerson.value = makePerson({ id: "p1" });
    await p.splitFaceAsNewPerson("p1", "face-3");
    expect(p.activePerson.value).toBeNull();
    expect(toastAdd).toHaveBeenCalledWith({ title: "Face moved to a new person" });
  });

  it("toasts when splitting a face fails", async () => {
    splitFace.reject(new Error("boom"));
    const p = useLibraryPeople(ref("lib1"));
    await p.splitFaceAsNewPerson("p1", "face-3");
    expect(toastAdd).toHaveBeenCalledWith({
      title: "Failed to create a new person from this face",
      color: "error",
    });
    expect(p.splittingFaceId.value).toBeNull();
  });

  it("closePersonDetail clears active person and faces", () => {
    const p = useLibraryPeople(ref("lib1"));
    p.activePerson.value = makePerson({ id: "p1" });
    p.activePersonFaces.value = [{ id: "f1" }] as never;
    p.closePersonDetail();
    expect(p.activePerson.value).toBeNull();
    expect(p.activePersonFaces.value).toEqual([]);
  });
});
