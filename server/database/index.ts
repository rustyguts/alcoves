import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString =
  process.env.ALCOVES_DATABASE_URL || "postgres://postgres:postgres@localhost:5455/alcoves";

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export { schema };
