import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

/**
 * Reads the newest URL straight from the env files (env, .env, .env.production,
 * .env.local) so `drizzle-kit push` always targets what the developer last saved.
 */
function loadEnvFiles() {
  for (const name of ["env", ".env", ".env.production", ".env.local"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    for (const raw of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      const q = v[0];
      if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "");
      if (v.trim()) process.env[m[1]] = v.trim();
    }
  }
}
loadEnvFiles();

const url = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "").trim();

if (!url) throw new Error("Set NEON_DATABASE_URL or DATABASE_URL (file env) before running Drizzle migrations.");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // All tables live in the custom "spaceprs" schema; without this filter drizzle-kit
  // only inspects "public" and tries to re-create existing tables on every push.
  schemaFilter: ["spaceprs"],
  dbCredentials: { url },
  // Never ask questions: push must run unattended.
  strict: false,
  verbose: false,
});
