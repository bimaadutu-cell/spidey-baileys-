import { NextRequest } from "next/server";
import { z } from "zod";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, scanAttempts, scanJobs } from "@/db/schema";
import { getCurrentUser, isAdmin } from "@/server/auth";
import { fail, json, readJson } from "@/server/http";
import { platformStats } from "@/server/services/preset-store";
import { bimzHealth } from "@/server/services/bimzLinkResolver";
import { bimzUpstreamHealth } from "@/server/services/bimz-preset-provider";
import { databaseHealth, getBotConfig, getBotStatus, saveBotConfig } from "@/server/services/chat";
import { listDeliveries, requeueDelivery } from "@/server/services/reviews";
import { runRetryQueue, ingestVideoUrl } from "@/server/services/preset-store";
import { backfillStatuses, runBulkHarvest, runDeepScanBatch, syncAllFromUpstream } from "@/server/services/bulk-harvest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const user = await getCurrentUser();
  if (!(await isAdmin(user))) return fail("Akses admin diperlukan", 403);

  const [stats, dbHealth, bot, bimz, deliveries, botConfig, upstream] = await Promise.all([
    platformStats(),
    databaseHealth(),
    getBotStatus(),
    bimzHealth(),
    listDeliveries(25),
    getBotConfig(),
    bimzUpstreamHealth(),
  ]);

  const jobs = await db.select().from(scanJobs).orderBy(desc(scanJobs.createdAt)).limit(20);
  const attempts = await db.select().from(scanAttempts).orderBy(desc(scanAttempts.createdAt)).limit(30);
  const activity = await db.select().from(activityLog).orderBy(desc(activityLog.createdAt)).limit(20);

  const scanOutcome = await db.execute<{ ok: number; failed: number }>(sql`
    select
      count(*) filter (where ok) ::int as ok,
      count(*) filter (where not ok) ::int as failed
    from spaceprs.scan_attempts
  `);

  return json({
    ok: true,
    stats,
    database: { ok: dbHealth.ok, latencyMs: dbHealth.latencyMs, error: dbHealth.error ?? null, schemaReady: true },
    bimz,
    bimzUpstream: upstream,
    botConfig,
    bot,
    deliveries,
    jobs: jobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      provider: job.provider,
      found: job.found,
      scanned: job.scanned,
      attempts: job.attempts,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    })),
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      stage: attempt.stage,
      provider: attempt.provider,
      ok: attempt.ok,
      statusCode: attempt.statusCode,
      message: attempt.message,
      createdAt: attempt.createdAt.toISOString(),
    })),
    activity: activity.map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      action: entry.action,
      level: entry.level,
      detail: entry.detail,
      createdAt: entry.createdAt.toISOString(),
    })),
    scanOutcome: {
      ok: Number(scanOutcome.rows[0]?.ok ?? 0),
      failed: Number(scanOutcome.rows[0]?.failed ?? 0),
    },
  });
}

const actionSchema = z.object({
  action: z.enum(["retry_scan", "retry_delivery", "keyword_scan", "save_bot_config", "bulk_harvest", "sync_upstream", "ingest_url", "deep_scan", "backfill"]),
  id: z.string().uuid().optional(),
  keyword: z.string().min(2).max(120).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  url: z.string().min(10).max(400).optional(),
  maxQueries: z.number().int().min(1).max(80).optional(),
  botConfig: z
    .object({
      botNumber: z.string().min(8).max(20).regex(/^\d+$/, "Nomor bot hanya angka"),
      targetNumber: z.string().max(20).regex(/^\d*$/).optional(),
      displayName: z.string().min(2).max(60).optional(),
      globalChatEnabled: z.boolean().optional(),
      reviewNotifyEnabled: z.boolean().optional(),
      platform: z.string().max(40).optional(),
      browser: z.string().max(40).optional(),
      integration: z.string().max(40).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!(await isAdmin(user))) return fail("Akses admin diperlukan", 403);

  const parsed = actionSchema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("Aksi tidak valid", 422);
  const actor = user?.username ?? "admin";

  if (parsed.data.action === "retry_scan") {
    const result = await runRetryQueue(parsed.data.limit ?? 3);
    await db.insert(activityLog).values({ actor, action: "retry_scan", detail: `${result.retried} preset dipindai ulang` });
    return json({
      ok: true,
      retried: result.retried,
      results: result.results.map((r) => ({
        presetId: r.presetId,
        overallStatus: r.overallStatus,
        xmlStatus: r.xmlStatus,
        fiveMbStatus: r.fiveMbStatus,
        confidence: r.confidence,
      })),
    });
  }

  if (parsed.data.action === "retry_delivery") {
    if (!parsed.data.id) return fail("ID pengiriman wajib diisi", 422);
    const ok = await requeueDelivery(parsed.data.id);
    await db.insert(activityLog).values({
      actor,
      action: "retry_delivery",
      detail: ok ? `Pengiriman ${parsed.data.id} masuk antrean lagi` : "Pengiriman tidak ditemukan",
    });
    return json({ ok, message: ok ? "Pengiriman dimasukkan kembali ke antrean" : "Tidak ditemukan" });
  }

  if (parsed.data.action === "save_bot_config") {
    if (!parsed.data.botConfig) return fail("Konfigurasi bot wajib diisi", 422);
    await saveBotConfig(parsed.data.botConfig);
    await db.insert(activityLog).values({
      actor,
      action: "save_bot_config",
      detail: `Nomor bot ${parsed.data.botConfig.botNumber} disimpan dari panel`,
    });
    return json({ ok: true, message: "Konfigurasi bot tersimpan", config: await getBotConfig() });
  }

  if (parsed.data.action === "bulk_harvest" || parsed.data.action === "sync_upstream") {
    const report =
      parsed.data.action === "sync_upstream"
        ? await syncAllFromUpstream({ maxQueries: parsed.data.maxQueries ?? 200, perQuery: 80 })
        : await runBulkHarvest({ maxQueries: parsed.data.maxQueries ?? 80, perQuery: 60 });
    await db.insert(activityLog).values({
      actor,
      action: parsed.data.action,
      detail: `${report.totalIngested} preset baru dari ${report.queriesRun} query (sumber: 3000-iptlrbb0xhnl0yfm0kz1x.e2b.app)`,
    });
    return json({
      ok: true,
      message: `Sinkron upstream selesai: ${report.totalIngested} baru, ${report.totalDuplicates} duplikat, ${report.queriesRun} query`,
      report,
    });
  }

  if (parsed.data.action === "backfill") {
    const result = await backfillStatuses();
    await db.insert(activityLog).values({
      actor,
      action: "backfill",
      detail: `Status disinkronkan: ${result.xml} XML, ${result.fiveMb} 5MB, ${result.complete} lengkap`,
    });
    return json({
      ok: true,
      message: `Sinkron selesai → ${result.xml} XML, ${result.fiveMb} 5MB, ${result.complete} lengkap`,
      report: result,
    });
  }

  if (parsed.data.action === "deep_scan") {
    const report = await runDeepScanBatch(parsed.data.limit ?? 8);
    await db.insert(activityLog).values({
      actor,
      action: "deep_scan",
      detail: `${report.scanned} preset dipindai, ${report.withXml} XML + ${report.withPackage} paket ditemukan`,
    });
    return json({
      ok: true,
      message: `Deep scan: ${report.scanned} preset → ${report.withXml} XML, ${report.withPackage} paket, ${report.empty} kosong`,
      report,
    });
  }

  if (parsed.data.action === "ingest_url") {
    if (!parsed.data.url) return fail("URL TikTok wajib diisi", 422);
    const result = await ingestVideoUrl(parsed.data.url, "panel_submit", { scan: true });
    return json({
      ok: result.ok,
      message: result.message,
      presetId: result.preset?.id ?? null,
      error: result.ok ? undefined : result.message,
    });
  }

  // keyword_scan is executed by POST /api/scan?mode=keyword with an admin session.
  return json({ ok: true, message: "Gunakan POST /api/scan?mode=keyword untuk menjalankan keyword scan" });
}
