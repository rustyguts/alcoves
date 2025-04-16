import { defineConfig } from "drizzle-kit";
// import { getDatabasePath } from "./src/lib/server/utils";

export default defineConfig({
	schema: "./src/db/schema/*",
	dialect: "sqlite",
	dbCredentials: {
		// url: `file:${getDatabasePath()}`,
		url: "file:../data/alcoves.db",
	},
});
