export default defineNitroPlugin(async () => {
  await ensureStorageDir();
});
