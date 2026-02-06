export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event);
  await session.clear();
  return { ok: true };
});
