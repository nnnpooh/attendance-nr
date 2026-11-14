import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./db/migration",
  dbCredentials: {
    url: "./data/db.sqlite",
  },
  verbose: true,
  strict: true,
});
