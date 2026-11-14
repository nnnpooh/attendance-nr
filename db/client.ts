import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@db/schema.js";

export const dbConn = new Database("./data/db.sqlite");
dbConn.pragma("journal_mode = WAL");
dbConn.pragma("foreign_keys = ON");
export const dbClient = drizzle(dbConn, { schema: schema, logger: false });
