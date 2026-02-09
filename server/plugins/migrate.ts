import { migrate } from "drizzle-orm/bun-sql/migrator";
import { db } from "../database";

export default defineNitroPlugin(async () => {
  await migrate(db, { migrationsFolder: "server/database/migrations" });
});
