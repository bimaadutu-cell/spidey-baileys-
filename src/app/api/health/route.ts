import { sql } from "drizzle-orm";
import { db, getDatabaseTarget } from "@/db";
import { config } from "@/server/config";
import { databaseHealth, getBotStatus } from "@/server/services/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const dbHealth = await databaseHealth();

  let bot: Awaited<ReturnType<typeof getBotStatus>> | null = null;
  try {
    bot = await getBotStatus();
  } catch {
    bot = null;
  }

  // Count our tables inside the dedicated schema. This never throws even when
  // the schema has not been migrated yet, so health reflects real connectivity.
  let tableCount = 0;
  let schemaError: string | null = null;
  if (dbHealth.ok) {
    try {
      const result = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from information_schema.tables where table_schema = 'spaceprs'`,
      );
      tableCount = Number(result.rows[0]?.n ?? 0);
    } catch (error) {
      schemaError = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    }
  }

  const ok = dbHealth.ok;

  return Response.json(
    {
      ok,
      app: { nameCn: "预设空间", name: "Preset Space", developer: "BimzOfficial ✓" },
      database: {
        ok: dbHealth.ok,
        latencyMs: dbHealth.latencyMs,
        error: dbHealth.error ?? null,
        schema: "spaceprs",
        tables: tableCount,
        schemaReady: tableCount >= 10,
        schemaError,
        provider: getDatabaseTarget(),
      },
      services: {
        searchProviders: {
          bimzIndex: config.bimz.upstreamUrl,
          tiktokOembed: config.providers.oembed,
          tikwm: config.providers.tikwm,
        },
        bimzResolver: { configured: config.bimz.enabled },
        premiumAlight: { configured: config.bimz.enabled },
        whatsappBot: bot ? { status: bot.status, live: bot.live } : { status: "unknown", live: false },
      },
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 500, headers: { "cache-control": "no-store" } },
  );
}
