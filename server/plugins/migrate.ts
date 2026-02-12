import { migrate } from "drizzle-orm/bun-sql/migrator";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../database";

export default defineNitroPlugin(async () => {
  const candidates = [
    resolve(process.cwd(), "server/database/migrations"),
    resolve(process.cwd(), "../server/database/migrations"),
  ];

  const migrationsFolder = candidates.find((folder) =>
    existsSync(resolve(folder, "meta/_journal.json")),
  );

  if (!migrationsFolder) {
    throw createError({
      statusCode: 500,
      statusMessage: "Database migrations folder not found",
      data: { checked: candidates },
    });
  }

  await migrate(db, { migrationsFolder });
});
