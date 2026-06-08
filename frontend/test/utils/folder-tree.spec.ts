import { describe, it, expect } from "vitest";
import type { LibraryFolder } from "~~/shared/types/api";
import {
  ROOT_MOVE_VALUE,
  buildFolderLabel,
  collectDescendantIds,
} from "~/utils/folder-tree";

function folder(id: string, parentFolderId: string | null, name = id): LibraryFolder {
  return {
    id,
    name,
    parentFolderId,
    libraryId: "lib-1",
    kind: "folder",
    trashedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    owner: null,
    tags: [],
  } as unknown as LibraryFolder;
}

describe("ROOT_MOVE_VALUE", () => {
  it("is the shared root sentinel", () => {
    expect(ROOT_MOVE_VALUE).toBe("__root__");
  });
});

describe("collectDescendantIds", () => {
  const tree = [
    folder("root", null),
    folder("a", "root"),
    folder("b", "root"),
    folder("a1", "a"),
    folder("a1x", "a1"),
    folder("other", null),
  ];

  it("collects the full subtree of a folder, excluding the root itself", () => {
    const ids = collectDescendantIds("root", tree);
    expect([...ids].sort()).toEqual(["a", "a1", "a1x", "b"]);
    expect(ids.has("root")).toBe(false);
    expect(ids.has("other")).toBe(false);
  });

  it("returns an empty set for a leaf folder", () => {
    expect(collectDescendantIds("a1x", tree).size).toBe(0);
  });

  it("returns an empty set for an unknown id", () => {
    expect(collectDescendantIds("missing", tree).size).toBe(0);
  });

  it("does not loop forever on a cyclic parent chain", () => {
    const cyclic = [folder("x", "y"), folder("y", "x")];
    const ids = collectDescendantIds("x", cyclic);
    expect(ids.has("y")).toBe(true);
    expect(ids.has("x")).toBe(true);
  });
});

describe("buildFolderLabel", () => {
  const folders = [
    folder("root", null, "Root"),
    folder("child", "root", "Child"),
    folder("grandchild", "child", "Grandchild"),
  ];
  const map = new Map(folders.map((f) => [f.id, f]));

  it("returns just the name for a top-level folder", () => {
    expect(buildFolderLabel(folders[0]!, map)).toBe("Root");
  });

  it("builds a breadcrumb path up the parent chain", () => {
    expect(buildFolderLabel(folders[2]!, map)).toBe("Root / Child / Grandchild");
  });

  it("stops at the first missing ancestor", () => {
    const orphan = folder("orphan", "ghost", "Orphan");
    expect(buildFolderLabel(orphan, map)).toBe("Orphan");
  });

  it("is bounded against cyclic parent references", () => {
    const a = folder("a", "b", "A");
    const b = folder("b", "a", "B");
    const cyclicMap = new Map([
      ["a", a],
      ["b", b],
    ]);
    const label = buildFolderLabel(a, cyclicMap);
    // Should terminate (guard caps the walk) and still include the folder name.
    expect(label.endsWith("A")).toBe(true);
  });
});
