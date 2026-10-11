import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { clientIp, fail, json, rateLimit, readJson, tooMany } from "@/server/http";
import {
  createScanJob,
  finishScanJob,
  runKeywordSearch,
  ingestVideoUrl,
  runRetryQueue,
  runUpstreamWarmup,
} from "@/server/services/preset-store";
import { runBulkHarvest, runDeepScanBatch } from "@/server/services/bulk-harvest";
import { db } from "@/db";
import { activityLog, scanJobs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  keyword: z.string().min(2).max(120),
  count: z.number().int().min(1).max(24).optional(),
});

const ingestSchema = z.object({
  url: z.string().min(10).max(500),
  scan: z.boolean().optional(),
});

const retrySchema = z.object({ limit: z.number().int().min(1).max(10).optional() });

/** GET — recent scan jobs (used by admin + scan history UI). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  const type = req.nextUrl.searchParams.get("type");
  const rows = await db
    .select()
    .from(scanJobs)
    .where(type ? eq(scanJobs.type, type) : undefined)
    .orderBy(desc(scanJobs.createdAt))
    .limit(30);
  return json({
    ok: true,
    jobs: rows.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      provider: job.provider,
      found: job.found,
      scanned: job.scanned,
      attempts: job.attempts,
      error: job.error,
      payload: job.payload,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const mode = req.nextUrl.searchParams.get("mode") ?? "keyword";
  const user = await getCurrentUser();
  const adminBypass = req.headers.get("x-internal-token") && process.env.INTERNAL_TOKEN &&
    req.headers.get("x-internal-token") === process.env.INTERNAL_TOKEN;

  if (!user && !adminBypass) {
    if (!rateLimit(`scan:${ip}`, 6, 60_000)) return tooMany();
  }

  const body = await readJson<unknown>(req);
  if (mode === "keyword") {
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Keyword tidak valid", 422);
    const jobId = await createScanJob("keyword_search", { keyword: parsed.data.keyword, triggeredBy: user?.username ?? "anonymous" }, "tikwm-search");
    await db.update(scanJobs).set({ status: "running", startedAt: new Date() }).where(eq(scanJobs.id, jobId));

    try {
      const report = await runKeywordSearch(parsed.data.keyword, parsed.data.count ?? 12, jobId);
      await finishScanJob(jobId, {
        status: "succeeded",
        finishedAt: new Date(),
        found: report.found,
        scanned: report.scanned,
        result: report as unknown as Record<string, unknown>,
        error: report.providers.every((p) => !p.ok) ? report.providers.map((p) => p.message).join(" | ").slice(0, 400) : null,
      });
      await db.insert(activityLog).values({
        actor: user?.username ?? "anonymous",
        action: "keyword_search",
        detail: `"${parsed.data.keyword}" → ${report.ingested} baru, ${report.duplicates} duplikat`,
      });
      return json({ ok: true, jobId, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : "scan gagal";
      await finishScanJob(jobId, { status: "failed", finishedAt: new Date(), error: message.slice(0, 400) });
      return fail(`Scan gagal: ${message}`, 502, { jobId });
    }
  }

  if (mode === "ingest") {
    const parsed = ingestSchema.safeParse(body);
    if (!parsed.success) return fail("URL TikTok tidak valid", 422);
    const jobId = await createScanJob("url_ingest", { url: parsed.data.url, triggeredBy: user?.username ?? "anonymous" });
    await db.update(scanJobs).set({ status: "running", startedAt: new Date() }).where(eq(scanJobs.id, jobId));
    try {
      const result = await ingestVideoUrl(parsed.data.url, "url_submit", { jobId, scan: parsed.data.scan !== false });
      await finishScanJob(jobId, {
        status: result.ok ? "succeeded" : "failed",
        finishedAt: new Date(),
        found: result.ok ? 1 : 0,
        scanned: result.ok ? 1 : 0,
        error: result.ok ? null : result.message.slice(0, 400),
        result: { message: result.message, presetId: result.preset?.id ?? null },
      });
      return json({ ok: result.ok, jobId, message: result.message, presetId: result.preset?.id ?? null }, { status: result.ok ? 200 : 502 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ingest gagal";
      await finishScanJob(jobId, { status: "failed", finishedAt: new Date(), error: message.slice(0, 400) });
      return fail(message, 502, { jobId });
    }
  }

  if (mode === "warmup") {
    // Pull the newest presets from the Bimz index (real videos + comment-derived links).
    const jobId = await createScanJob("bimz_warmup", { limit: 24, triggeredBy: user?.username ?? "anonymous" }, "restapi-bimz");
    await db.update(scanJobs).set({ status: "running", startedAt: new Date() }).where(eq(scanJobs.id, jobId));
    try {
      const report = await runUpstreamWarmup(24, jobId);
      await finishScanJob(jobId, {
        status: "succeeded",
        finishedAt: new Date(),
        found: report.found,
        scanned: report.ingested,
        result: report as unknown as Record<string, unknown>,
      });
      await db.insert(activityLog).values({
        actor: user?.username ?? "system",
        action: "bimz_warmup",
        detail: `${report.ingested} preset baru dari indeks Bimz`,
      });
      return json({ ok: true, jobId, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : "warmup gagal";
      await finishScanJob(jobId, { status: "failed", finishedAt: new Date(), error: message.slice(0, 400) });
      return fail(message, 502, { jobId });
    }
  }

  if (mode === "harvest") {
    // Bulk harvest: walks the whole keyword/hashtag space and ingests every preset.
    const jobId = await createScanJob("bulk_harvest", { triggeredBy: user?.username ?? "anonymous" }, "restapi-bimz");
    await db.update(scanJobs).set({ status: "running", startedAt: new Date() }).where(eq(scanJobs.id, jobId));
    try {
      const report = await runBulkHarvest({ maxQueries: 40, jobId });
      await finishScanJob(jobId, {
        status: "succeeded",
        finishedAt: new Date(),
        found: report.totalFound,
        scanned: report.totalIngested,
        result: report as unknown as Record<string, unknown>,
      });
      return json({ ok: true, jobId, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : "harvest gagal";
      await finishScanJob(jobId, { status: "failed", finishedAt: new Date(), error: message.slice(0, 400) });
      return fail(message, 502, { jobId });
    }
  }

  if (mode === "deepscan") {
    // Real Bimz deep scan over a bounded batch — safe for serverless limits.
    const limit = Math.min(Math.max(Number((body as { limit?: number } | null)?.limit ?? 8), 1), 25);
    const jobId = await createScanJob("deep_scan", { limit, triggeredBy: user?.username ?? "anonymous" }, "restapi-bimz/alight");
    await db.update(scanJobs).set({ status: "running", startedAt: new Date() }).where(eq(scanJobs.id, jobId));
    try {
      const report = await runDeepScanBatch(limit, jobId);
      await finishScanJob(jobId, {
        status: "succeeded",
        finishedAt: new Date(),
        found: report.withXml + report.withPackage,
        scanned: report.scanned,
        result: report as unknown as Record<string, unknown>,
      });
      return json({ ok: true, jobId, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : "deep scan gagal";
      await finishScanJob(jobId, { status: "failed", finishedAt: new Date(), error: message.slice(0, 400) });
      return fail(message, 502, { jobId });
    }
  }

  if (mode === "retry") {
    if (!user && !adminBypass) return fail("Login diperlukan untuk menjalankan retry queue", 401);
    const parsed = retrySchema.safeParse(body ?? {});
    const limit = parsed.success ? parsed.data.limit ?? 3 : 3;
    const result = await runRetryQueue(limit);
    await db.insert(activityLog).values({
      actor: user?.username ?? "worker",
      action: "retry_queue",
      detail: `${result.retried} preset dipindai ulang`,
    });
    return json({ ok: true, ...result });
  }

  return fail("Mode tidak dikenal", 400);
}
