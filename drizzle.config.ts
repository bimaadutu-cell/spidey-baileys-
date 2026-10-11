import { defineConfig } from "drizzle-kit";

const url =
  (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "").trim() ||
  "postgresql://localhost:5432/postgres";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
