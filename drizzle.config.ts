import { defineConfig } from "drizzle-kit";

const url =
  (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "").trim();

if (!url) throw new Error("Set NEON_DATABASE_URL or DATABASE_URL before running Drizzle migrations.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
