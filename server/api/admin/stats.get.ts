import { sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineEventHandler(async (event) => {
  await requireOwner(event);

  const [[fileStats], [libraryStats], [userStats]] = await Promise.all([
    db
      .select({
        totalFiles: sql<number>`count(*)::int`,
        totalSizeBytes: sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`,
      })
      .from(schema.files),
    db.select({ totalLibraries: sql<number>`count(*)::int` }).from(schema.libraries),
    db.select({ totalUsers: sql<number>`count(*)::int` }).from(schema.users),
  ]);

  const totalFiles = Number(fileStats?.totalFiles ?? 0);
  const totalSizeBytes = Number(fileStats?.totalSizeBytes ?? 0);
  const averageFileSizeBytes = totalFiles > 0 ? Math.round(totalSizeBytes / totalFiles) : 0;

  return {
    totalFiles,
    totalSizeBytes,
    averageFileSizeBytes,
    totalLibraries: Number(libraryStats?.totalLibraries ?? 0),
    totalUsers: Number(userStats?.totalUsers ?? 0),
  };
});
