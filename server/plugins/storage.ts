export default defineNitroPlugin(async () => {
  await useStorageService().ensureReady();
});
