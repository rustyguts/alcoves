import { defineConfig } from "drizzle-kit";
import { getDatabasePath } from "./src/lib/server/utils";

export default defineConfig({
	schema: "./src/lib/db/schema/*",
	dialect: "sqlite",
	dbCredentials: {
		url: `file:${getDatabasePath()}`,
	},
});
