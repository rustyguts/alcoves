export default defineEventHandler(async (event) => {
  await requireOwner(event);

  if (!isQueueConfigured()) {
    return { queues: [], configured: false };
  }

  const queues = await getAllQueueStats();
  return { queues, configured: true };
});
