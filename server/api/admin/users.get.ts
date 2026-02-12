import { desc, inArray, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt));

  const userIds = users.map((user) => user.id);

  const fileStatsRows = userIds.length
    ? await db
        .select({
          ownerId: schema.files.ownerId,
          fileCount: sql<number>`count(*)::int`,
          totalSizeBytes: sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`,
        })
        .from(schema.files)
        .where(inArray(schema.files.ownerId, userIds))
        .groupBy(schema.files.ownerId)
    : [];

  const lastLoginRows = userIds.length
    ? await db
        .select({
          userId: schema.sessions.userId,
          lastLoggedInAt: sql<string | null>`max(${schema.sessions.createdAt})`,
        })
        .from(schema.sessions)
        .where(inArray(schema.sessions.userId, userIds))
        .groupBy(schema.sessions.userId)
    : [];

  const fileStatsByOwnerId = new Map(
    fileStatsRows
      .filter((row) => Boolean(row.ownerId))
      .map((row) => [
        row.ownerId!,
        {
          fileCount: Number(row.fileCount ?? 0),
          totalSizeBytes: Number(row.totalSizeBytes ?? 0),
        },
      ]),
  );

  const lastLoginByUserId = new Map(
    lastLoginRows.map((row) => [row.userId, row.lastLoggedInAt ?? null]),
  );

  return users.map((user) => {
    const fileStats = fileStatsByOwnerId.get(user.id);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoggedInAt: lastLoginByUserId.get(user.id) ?? null,
      uploadedFileCount: fileStats?.fileCount ?? 0,
      uploadedSizeBytes: fileStats?.totalSizeBytes ?? 0,
    };
  });
});
