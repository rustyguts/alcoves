import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "../database";

export default defineNitroPlugin(async () => {
  await migrate(db, { migrationsFolder: "server/database/migrations" });
});
