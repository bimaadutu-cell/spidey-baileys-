import "@/server/runtime-config";
import { spawn } from "node:child_process";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { currentDatabaseUrl, onDatabaseUrlChange, startEnvWatcher } from "@/server/env-watcher";

/**
 * Connection priority:
 *   1. NEON_DATABASE_URL  — explicit app database
 *   2. DATABASE_URL       — standard/platform-provided value
 *
 * The URL is re-read LIVE: when a developer edits NEON_DATABASE_URL /
 * DATABASE_URL in the env file (see env-watcher.ts) a new pool is created,
 * `db` / `pool` start using it immediately, the old pool is drained and the
 * schema is pushed to the new database automatically. No restart needed.
 */

type DbState = {
  url: string;
  pool: Pool;
  db: NodePgDatabase;
  target: string;
  generation: number;
};

const globalForDb = globalThis as typeof globalThis & {
  __presetSpaceDb?: DbState;
  __presetSpaceDbWatching?: boolean;
  __presetSpaceDbSwapTimer?: NodeJS.Timeout;
};

function validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("protocol");
  } catch {
    throw new Error("NEON_DATABASE_URL/DATABASE_URL bukan URL PostgreSQL yang valid.");
  }
}

function buildState(url: string, generation: number): DbState {
  validateUrl(url);
  const isNeon = /neon\.tech/i.test(url);
  const pool = new Pool({
    connectionString: url,
    // Neon's pooler terminates idle connections; keep the pool small and
    // resilient so serverless invocations never reuse a dead socket.
    max: isNeon ? 5 : 10,
    idleTimeoutMillis: isNeon ? 10_000 : 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    ...(isNeon || /sslmode=require/i.test(url) ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });
  return { url, pool, db: drizzle(pool), target: isNeon ? "neon-postgres" : "postgres", generation };
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.host}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

/** Fire-and-forget `node scripts/db-push.mjs` so every table exists on the new database. */
function pushSchemaInBackground(reason: string): void {
  try {
    const child = spawn(process.execPath, ["scripts/db-push.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DRIZZLE_PUSH_FORCE: process.env.DRIZZLE_PUSH_FORCE ?? "1", DB_PUSH_NONFATAL: "1" },
      stdio: "inherit",
    });
    child.on("error", (error) => console.error(`[db] schema push (${reason}) could not start:`, error.message));
    child.on("exit", (code) => console.log(`[db] schema push (${reason}) finished with code ${code}`));
  } catch (error) {
    console.error(`[db] schema push (${reason}) failed:`, error instanceof Error ? error.message : error);
  }
}

function current(): DbState {
  startWatching();
  const url = currentDatabaseUrl();
  if (!url) {
    throw new Error("Database belum dikonfigurasi. Isi NEON_DATABASE_URL (disarankan) atau DATABASE_URL di file env / environment deployment.");
  }
  const existing = globalForDb.__presetSpaceDb;
  // Self-heal: even if the watcher missed an event, a changed URL is detected here.
  if (existing && existing.url === url) return existing;
  return swap(url, existing ? "lazy-detect" : "first-use");
}

function swap(url: string, reason: string): DbState {
  const previous = globalForDb.__presetSpaceDb;
  const next = buildState(url, (previous?.generation ?? 0) + 1);
  globalForDb.__presetSpaceDb = next;

  if (previous) {
    console.log(`[db] DATABASE_URL changed (${reason}) -> ${maskUrl(url)} (was ${maskUrl(previous.url)})`);
    // Let in-flight queries on the old pool finish, then close it.
    setTimeout(() => {
      previous.pool.end().catch(() => undefined);
    }, 15_000).unref?.();
    pushSchemaInBackground("url-changed");
  } else {
    console.log(`[db] connected target ${maskUrl(url)}`);
  }
  return next;
}

function startWatching(): void {
  if (globalForDb.__presetSpaceDbWatching) return;
  globalForDb.__presetSpaceDbWatching = true;
  startEnvWatcher();
  onDatabaseUrlChange(() => {
    // Debounce: editors often write a file twice.
    if (globalForDb.__presetSpaceDbSwapTimer) clearTimeout(globalForDb.__presetSpaceDbSwapTimer);
    globalForDb.__presetSpaceDbSwapTimer = setTimeout(() => {
      const url = currentDatabaseUrl();
      if (!url) return;
      if (globalForDb.__presetSpaceDb?.url === url) return;
      try {
        swap(url, "env-watcher");
      } catch (error) {
        console.error("[db] ignoring invalid new database URL, keeping old connection:", error instanceof Error ? error.message : error);
      }
    }, 300);
    globalForDb.__presetSpaceDbSwapTimer.unref?.();
  });
}

/** Always delegates to the CURRENT pool, so a live URL change is picked up by every caller. */
function liveProxy<T extends object>(pick: (state: DbState) => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = pick(current());
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(_target, prop) {
      return Reflect.has(pick(current()), prop);
    },
  });
}

export const pool: Pool = liveProxy((s) => s.pool);
export const db: NodePgDatabase = liveProxy((s) => s.db);

/** Provider label of the connection currently in use ("neon-postgres" | "postgres"). */
export let databaseTarget = /neon\.tech/i.test(currentDatabaseUrl()) ? "neon-postgres" : "postgres";
export function getDatabaseTarget(): string {
  try {
    databaseTarget = current().target;
  } catch {
    /* not configured yet */
  }
  return databaseTarget;
}

// Start watching immediately so edits are applied even before the first query.
startWatching();
