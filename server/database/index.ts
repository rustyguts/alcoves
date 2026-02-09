import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

const connectionString =
  process.env.ALCOVES_DATABASE_URL || "postgres://postgres:postgres@localhost:5455/alcoves";

const client = new SQL(connectionString);
export const db = drizzle(client, { schema });
export { schema };
