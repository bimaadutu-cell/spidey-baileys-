/**
 * Installs / syncs EVERY table automatically — no prompts, no manual steps.
 *
 *  1. Reads the newest DATABASE_URL / NEON_DATABASE_URL from the env files
 *     (env, .env, .env.production, .env.local) so a developer edit is used
 *     immediately; platform variables are the fallback.
 *  2. Runs `drizzle-kit push --force` (FORCE IS ON BY DEFAULT; set
 *     DRIZZLE_PUSH_FORCE=0 to turn it off).
 *  3. If drizzle-kit is not available / fails, falls back to an idempotent SQL
 *     install of the whole schema (drizzle/0000_*.sql + add-on tables), so the
 *     tables always exist.
 *
 * Exit code is 0 unless DB_PUSH_STRICT=1, so a temporary DB problem never takes
 * the website down: fix the URL in the env file and the running app reconnects
 * and re-pushes by itself.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const ENV_FILES = ["env", ".env", ".env.production", ".env.local"]; // increasing priority

function parseEnv(text) {
  const out = {};
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v.trim();
  }
  return out;
}

// Files win over inherited variables: that is what makes a developer edit take effect.
for (const name of ENV_FILES) {
  const file = path.join(ROOT, name);
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(file, "utf8")))) {
        if (v !== "") process.env[k] = v;
      }
    }
  } catch {
    /* ignore unreadable file */
  }
}

const url = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const strict = process.env.DB_PUSH_STRICT === "1";
const force = !["0", "false", "off", "no"].includes(String(process.env.DRIZZLE_PUSH_FORCE ?? "1").toLowerCase());

function done(code) {
  process.exit(strict ? code : 0);
}

if (!url) {
  console.error("[db-push] ERROR: isi NEON_DATABASE_URL atau DATABASE_URL di file env / variabel deployment.");
  done(1);
}

const mask = (u) => u.replace(/\/\/[^@/]*@/, "//***@");
console.log(`[db-push] target: ${mask(url)} | force=${force}`);

// Make sure drizzle.config.ts (which reads NEON_DATABASE_URL first) sees the same URL.
process.env.NEON_DATABASE_URL = url;
process.env.DATABASE_URL = url;

const ssl = /neon\.tech|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;

/* ---------------------------------------------------------------- step 1 */
function runDrizzleKit() {
  const localBin = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit");
  const hasConfig = fs.existsSync(path.join(ROOT, "drizzle.config.ts")) && fs.existsSync(path.join(ROOT, "src", "db", "schema.ts"));
  if (!hasConfig) {
    console.warn("[db-push] drizzle.config.ts / src/db/schema.ts tidak ada — lewati drizzle-kit.");
    return false;
  }
  const args = ["push"];
  if (force) args.push("--force");

  const cmd = fs.existsSync(localBin) ? localBin : "npx";
  const fullArgs = fs.existsSync(localBin) ? args : ["--yes", "drizzle-kit@0.31.10", ...args];
  const res = spawnSync(cmd, fullArgs, {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"], // never wait for an interactive answer
    env: process.env,
    shell: process.platform === "win32",
    timeout: 5 * 60_000,
  });
  if (res.status === 0) return true;
  console.warn(`[db-push] drizzle-kit push gagal (status ${res.status ?? res.signal ?? "?"}) — memakai fallback SQL.`);
  return false;
}

/* ---------------------------------------------------------------- step 2 */
const ADDON_SQL = `
CREATE SCHEMA IF NOT EXISTS spaceprs;

CREATE TABLE IF NOT EXISTS spaceprs.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_follows_uq ON spaceprs.user_follows (follower_id, following_id);
CREATE INDEX IF NOT EXISTS user_follows_following_idx ON spaceprs.user_follows (following_id);

CREATE TABLE IF NOT EXISTS spaceprs.preset_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  preset_id uuid NOT NULL REFERENCES spaceprs.presets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS preset_favorites_uq ON spaceprs.preset_favorites (user_id, preset_id);
CREATE INDEX IF NOT EXISTS preset_favorites_user_idx ON spaceprs.preset_favorites (user_id);

CREATE TABLE IF NOT EXISTS spaceprs.preset_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id uuid NOT NULL REFERENCES spaceprs.presets(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES spaceprs.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preset_views_preset_idx ON spaceprs.preset_views (preset_id);

CREATE TABLE IF NOT EXISTS spaceprs.user_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES spaceprs.users(id) ON DELETE CASCADE,
  preset_id uuid REFERENCES spaceprs.presets(id) ON DELETE SET NULL,
  title text NOT NULL,
  caption text,
  video_url text NOT NULL,
  thumbnail_url text,
  xml_url text,
  five_mb_url text,
  status text NOT NULL DEFAULT 'published',
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_uploads_user_idx ON spaceprs.user_uploads (user_id);
CREATE INDEX IF NOT EXISTS user_uploads_created_idx ON spaceprs.user_uploads (created_at);

ALTER TABLE spaceprs.presets ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
ALTER TABLE spaceprs.presets ADD COLUMN IF NOT EXISTS favorite_count integer NOT NULL DEFAULT 0;
ALTER TABLE spaceprs.presets ADD COLUMN IF NOT EXISTS uploader_user_id uuid REFERENCES spaceprs.users(id) ON DELETE SET NULL;
`;

/** Turns the generated drizzle migration into statements that can be re-run safely. */
function idempotentStatements(sqlText) {
  return sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((stmt) => {
      let s = stmt.replace(/;\s*$/, "");
      if (/^CREATE SCHEMA\s/i.test(s)) return s.replace(/^CREATE SCHEMA\s+/i, "CREATE SCHEMA IF NOT EXISTS ");
      if (/^CREATE TABLE\s/i.test(s)) return s.replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS ");
      if (/^CREATE UNIQUE INDEX\s/i.test(s)) return s.replace(/^CREATE UNIQUE INDEX\s+/i, "CREATE UNIQUE INDEX IF NOT EXISTS ");
      if (/^CREATE INDEX\s/i.test(s)) return s.replace(/^CREATE INDEX\s+/i, "CREATE INDEX IF NOT EXISTS ");
      if (/^ALTER TABLE[\s\S]*ADD CONSTRAINT/i.test(s)) {
        return `DO $$ BEGIN ${s}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
      }
      return s;
    });
}

async function sqlFallback(client) {
  const dir = path.join(ROOT, "drizzle");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    /* no migrations folder */
  }
  for (const file of files) {
    const statements = idempotentStatements(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (err) {
        console.warn(`[db-push] ${file}: ${String(err?.message || err).slice(0, 160)}`);
      }
    }
    console.log(`[db-push] applied ${file} (${statements.length} statements, idempotent)`);
  }
  await client.query(ADDON_SQL);
}

/* ------------------------------------------------------------------ main */
async function waitForDatabase() {
  let lastError;
  const retries = Number(process.env.DB_PUSH_RETRIES ?? (process.env.npm_lifecycle_event === "build" ? 2 : 5));
  for (let attempt = 1; attempt <= retries; attempt++) {
    const probe = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 15_000 });
    try {
      await probe.connect();
      await probe.query("select 1");
      await probe.end();
      return true;
    } catch (err) {
      lastError = err;
      try {
        await probe.end();
      } catch {
        /* ignore */
      }
      console.warn(`[db-push] database belum bisa dihubungi (percobaan ${attempt}/${retries}): ${err?.message || err}`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  console.error("[db-push] Gagal terhubung ke database:", lastError?.message || lastError);
  return false;
}

if (!(await waitForDatabase())) done(1);

const pushedByKit = runDrizzleKit();

const client = new pg.Client({ connectionString: url, ssl });
try {
  await client.connect();
  if (!pushedByKit) await sqlFallback(client);
  // Always run the add-on SQL: it is idempotent and guarantees follow/favorite/view/upload tables.
  if (pushedByKit) await client.query(ADDON_SQL);
  const { rows } = await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'spaceprs'");
  console.log(`[db-push] Schema OK — ${rows[0].n} tabel di schema "spaceprs" (${pushedByKit ? "drizzle-kit --force" : "SQL fallback"})`);
} catch (err) {
  console.error("[db-push] Failed:", err?.message || err);
  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch {
    /* ignore */
  }
}
if (process.exitCode) done(process.exitCode);
