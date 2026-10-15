import { spawn } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Number of tables the full schema defines (see src/db/schema.ts). */
const EXPECTED_TABLES = Number(process.env.EXPECTED_TABLE_COUNT ?? 23);

let running = false;

async function tableCount(): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from information_schema.tables where table_schema = 'spaceprs'`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Self-healing installer: on boot (and from /api/health) checks that every table
 * exists and, if not, runs scripts/db-push.mjs. Safe to call repeatedly.
 */
export async function ensureSchema(reason = "boot"): Promise<{ ok: boolean; tables: number; pushed: boolean }> {
  let tables = 0;
  try {
    tables = await tableCount();
  } catch {
    tables = 0; // schema/db not reachable yet -> try to install
  }
  if (tables >= EXPECTED_TABLES) return { ok: true, tables, pushed: false };
  if (running) return { ok: false, tables, pushed: false };
  running = true;
  console.log(`[schema] ${tables}/${EXPECTED_TABLES} tabel (${reason}) — menjalankan db-push otomatis…`);
  await new Promise<void>((resolve) => {
    try {
      const child = spawn(process.execPath, ["scripts/db-push.mjs"], {
        cwd: process.cwd(),
        env: { ...process.env, DRIZZLE_PUSH_FORCE: process.env.DRIZZLE_PUSH_FORCE ?? "1" },
        stdio: "inherit",
      });
      child.on("error", () => resolve());
      child.on("exit", () => resolve());
    } catch {
      resolve();
    }
  });
  running = false;
  try {
    tables = await tableCount();
  } catch {
    /* keep last value */
  }
  return { ok: tables >= EXPECTED_TABLES, tables, pushed: true };
}
