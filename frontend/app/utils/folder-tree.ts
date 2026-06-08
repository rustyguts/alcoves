import type { LibraryFolder } from "~~/shared/types/api";

// Sentinel value used by the "move to folder" selects to represent the library
// root (no parent folder). Shared so the file-move and folder-move UIs agree.
export const ROOT_MOVE_VALUE = "__root__";

/**
 * Collect the ids of every descendant of `rootId` (children, grandchildren, …).
 * Used to exclude a folder's own subtree from its move-destination options so a
 * folder can't be moved into itself. The result never includes `rootId`.
 */
export function collectDescendantIds(rootId: string, folders: LibraryFolder[]): Set<string> {
  const children = new Map<string | null, LibraryFolder[]>();
  for (const folder of folders) {
    const key = folder.parentFolderId;
    const list = children.get(key) ?? [];
    list.push(folder);
    children.set(key, list);
  }

  const descendants = new Set<string>();
  const stack = [rootId];

  while (stack.length) {
    const current = stack.pop()!;
    const directChildren = children.get(current) ?? [];
    for (const child of directChildren) {
      if (descendants.has(child.id)) continue;
      descendants.add(child.id);
      stack.push(child.id);
    }
  }

  return descendants;
}

/**
 * Build a breadcrumb-style label for a folder ("Parent / Child / Leaf") by
 * walking up the parent chain via `folderMap`. The walk is bounded to 100 hops
 * to guard against cyclic data.
 */
export function buildFolderLabel(
  folder: LibraryFolder,
  folderMap: Map<string, LibraryFolder>,
): string {
  const parts: string[] = [folder.name];
  let current = folder.parentFolderId;
  let guard = 0;

  while (current && guard < 100) {
    const parent = folderMap.get(current);
    if (!parent) break;
    parts.unshift(parent.name);
    current = parent.parentFolderId;
    guard++;
  }

  return parts.join(" / ");
}
