import { ALCOVES_DB_PATH } from "$env/static/private";
import { drizzle } from "drizzle-orm/bun-sqlite";

export const db = drizzle(ALCOVES_DB_PATH);
