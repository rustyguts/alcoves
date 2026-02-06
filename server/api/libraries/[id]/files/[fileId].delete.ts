import { deleteFiles } from "~~/server/utils/store";

export default defineEventHandler(async (event) => {
  const fileId = getRouterParam(event, "fileId")!;
  const body = await readBody<{ fileIds?: string[] }>(event).catch(() => null);
  const ids = body?.fileIds ?? [fileId];
  const deleted = deleteFiles(ids);
  return { deleted };
});
