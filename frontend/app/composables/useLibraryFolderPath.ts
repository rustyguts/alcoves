import type { FolderBreadcrumb } from "~~/shared/types/api";

/**
 * Shared store for the current Files-tab folder ancestry.
 *
 * The library header (rendered by the `library` layout, the *parent*) needs the
 * folder breadcrumb that the Files page (`index.vue`, the *child*) computes.
 * provide/inject only flows parent→child, so the page publishes its path here
 * and the header reads it. The path holds only the folder ancestors — the
 * header prepends the library-name root crumb. It is empty on the library root,
 * in trash, and on every non-Files tab (the page clears it on unmount).
 */
export function useLibraryFolderPath() {
  return useState<FolderBreadcrumb[]>("alcoves:library-folder-path", () => []);
}
