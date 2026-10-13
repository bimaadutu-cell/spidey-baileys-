import "@/server/runtime-config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Connection priority:
 *   1. NEON_DATABASE_URL  — explicit app database (wins over anything the host injects)
 *   2. DATABASE_URL       — standard/platform-provided value
 *
 * A managed host may inject its own DATABASE_URL into the real process
 * environment, which always beats .env files. NEON_DATABASE_URL gives the
 * application a dedicated key that nothing else overwrites, so the same code
 * runs locally, in this sandbox and on Vercel without edits.
 */
const rawNeon = (process.env.NEON_DATABASE_URL ?? "").trim();
const rawStandard = (process.env.DATABASE_URL ?? "").trim();
// Prefer the explicitly configured Neon URL. Never silently fall back to localhost
// or a baked-in credential: that can make a deploy look healthy while using the wrong DB.
const databaseUrl = rawNeon || rawStandard;

if (!databaseUrl) {
  throw new Error("Database belum dikonfigurasi. Isi NEON_DATABASE_URL (disarankan) atau DATABASE_URL di environment deployment.");
}

try {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("protocol");
  }
} catch {
  throw new Error("NEON_DATABASE_URL/DATABASE_URL bukan URL PostgreSQL yang valid.");
}

const isNeon = /neon\.tech/i.test(databaseUrl);

const globalForDb = globalThis as typeof globalThis & {
  __presetSpacePool?: Pool;
};

export const pool =
  globalForDb.__presetSpacePool ??
  new Pool({
    connectionString: databaseUrl,
    // Neon's pooler terminates idle connections; keep the pool small and
    // resilient so serverless/edge invocations never reuse a dead socket.
    max: isNeon ? 5 : 10,
    idleTimeoutMillis: isNeon ? 10_000 : 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    ...(isNeon || /sslmode=require/i.test(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {}),
  });

pool.on("error", (error) => {
  console.error("[db] idle client error:", error.message);
});

if (process.env.NODE_ENV !== "production") {
  globalForDb.__presetSpacePool = pool;
}

export const db = drizzle(pool);
export const databaseTarget = isNeon ? "neon-postgres" : "postgres";
