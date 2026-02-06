import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/database/schema.ts",
  out: "./server/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.ALCOVES_DATABASE_URL || "postgres://postgres:postgres@localhost:5455/alcoves",
  },
});
