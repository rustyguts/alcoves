import type { PaginatedFiles } from "~~/shared/types/api";
import { listLibraryFiles } from "~~/server/services/library/files";

export default defineEventHandler(async (event): Promise<PaginatedFiles> => {
  const libraryId = getRouterParam(event, "id")!;
  const query = getQuery(event);
  return listLibraryFiles(libraryId, query);
});
