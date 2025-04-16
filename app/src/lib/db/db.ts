import { ALCOVES_DB_PATH } from "$env/static/private";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as asset from "./schema/asset";
import * as user from "./schema/user";

export const db = drizzle(ALCOVES_DB_PATH, {
	schema: { ...asset, ...user },
});
