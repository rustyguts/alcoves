import { randomUUIDv7 } from "bun";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const assets = sqliteTable("assets", {
	id: text().primaryKey().$defaultFn(randomUUIDv7),
	// id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
	exif: text({ mode: "json" }),
	sourceStoragePath: text(),
	optimizedStoragePath: text(),
	status: text({ enum: ["PROCESSING", "READY", "ERROR"] }).default(
		"PROCESSING",
	),
	cTime: integer({ mode: "timestamp" }).default(sql`(CURRENT_TIMESTAMP)`),
	createdAt: integer({ mode: "timestamp" }).default(sql`(CURRENT_TIMESTAMP)`),
	updatedAt: integer({ mode: "timestamp" }).default(sql`(CURRENT_TIMESTAMP)`),
});
