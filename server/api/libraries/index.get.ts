import { getLibraries } from "~~/server/utils/store";

export default defineEventHandler(() => {
  return getLibraries();
});
