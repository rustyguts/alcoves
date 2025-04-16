import { randomUUIDv7 } from "bun";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("users", {
	id: text().primaryKey().$defaultFn(randomUUIDv7),
	createdAt: integer({ mode: "timestamp" }).default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: integer({ mode: "timestamp" }).default(sql`(CURRENT_TIMESTAMP)`),
});
