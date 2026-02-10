import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useLibraryPeople } from "~/composables/useLibraryPeople";
import type { LibraryPerson } from "~~/shared/types/api";

const mocks = vi.hoisted(() => ({
  toast: { add: vi.fn() },
  fetch: vi.fn(),
}));

mockNuxtImport("useToast", () => () => mocks.toast);

function makePerson(overrides: Partial<LibraryPerson> & { id: string }): LibraryPerson {
  return {
    id: overrides.id,
    libraryId: "lib-1",
    name: "Unknown",
    faceCount: 1,
    coverFaceDetectionId: "face-1",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useLibraryPeople", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.toast.add.mockReset();
    vi.stubGlobal("$fetch", mocks.fetch);
  });

  it("setPersonCover updates people and active person state", async () => {
    const person = makePerson({ id: "person-1", coverFaceDetectionId: "face-1" });
    const updated = makePerson({
      id: "person-1",
      coverFaceDetectionId: "face-2",
      updatedAt: "2025-01-02T00:00:00Z",
    });

    mocks.fetch.mockResolvedValueOnce(updated);

    const peopleState = useLibraryPeople(ref("lib-1"));
    peopleState.people.value = [person];
    peopleState.activePerson.value = person;

    await peopleState.setPersonCover("person-1", "face-2");

    expect(mocks.fetch).toHaveBeenCalledWith("/api/libraries/lib-1/people/person-1", {
      method: "PATCH",
      body: { coverFaceDetectionId: "face-2" },
    });
    expect(peopleState.people.value[0]?.coverFaceDetectionId).toBe("face-2");
    expect(peopleState.activePerson.value?.coverFaceDetectionId).toBe("face-2");
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Cover photo updated" });
    expect(peopleState.updatingCoverFaceId.value).toBeNull();
  });

  it("getPersonThumbnailUrl busts cache when cover changes", () => {
    const peopleState = useLibraryPeople(ref("lib-1"));

    const withCover = makePerson({ id: "person-1", coverFaceDetectionId: "face-123" });
    const withoutCover = makePerson({
      id: "person-2",
      coverFaceDetectionId: null,
      updatedAt: "2025-01-10T12:00:00Z",
    });

    expect(peopleState.getPersonThumbnailUrl(withCover)).toBe(
      "/api/libraries/lib-1/people/person-1/thumbnail?v=face-123",
    );
    expect(peopleState.getPersonThumbnailUrl(withoutCover)).toBe(
      "/api/libraries/lib-1/people/person-2/thumbnail?v=2025-01-10T12%3A00%3A00Z",
    );
  });

  it("renamePerson updates active person when matching id", async () => {
    const person = makePerson({ id: "person-1", name: "Unknown" });
    const updated = makePerson({ id: "person-1", name: "Alice" });

    mocks.fetch.mockResolvedValueOnce(updated);

    const peopleState = useLibraryPeople(ref("lib-1"));
    peopleState.people.value = [person];
    peopleState.activePerson.value = person;

    await peopleState.renamePerson("person-1", "Alice");

    expect(peopleState.people.value[0]?.name).toBe("Alice");
    expect(peopleState.activePerson.value?.name).toBe("Alice");
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Person renamed" });
  });

  it("splitFaceAsNewPerson refreshes people and active person faces", async () => {
    const person = makePerson({ id: "person-1", name: "Taylor", faceCount: 2 });
    const refreshedPerson = makePerson({ id: "person-1", name: "Taylor", faceCount: 1 });

    mocks.fetch
      .mockResolvedValueOnce({}) // split POST
      .mockResolvedValueOnce([refreshedPerson]) // fetchPeople
      .mockResolvedValueOnce([]); // loadPersonFaces

    const peopleState = useLibraryPeople(ref("lib-1"));
    peopleState.people.value = [person];
    peopleState.activePerson.value = person;

    await peopleState.splitFaceAsNewPerson("person-1", "face-2", "Jordan");

    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/libraries/lib-1/people/person-1/faces/face-2/split",
      {
        method: "POST",
        body: { name: "Jordan" },
      },
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, "/api/libraries/lib-1/people");
    expect(mocks.fetch).toHaveBeenNthCalledWith(3, "/api/libraries/lib-1/people/person-1/faces");
    expect(peopleState.people.value[0]?.faceCount).toBe(1);
    expect(mocks.toast.add).toHaveBeenCalledWith({ title: "Face moved to a new person" });
    expect(peopleState.splittingFaceId.value).toBeNull();
  });
});
