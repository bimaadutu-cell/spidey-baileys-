import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { presets, scanAttempts, scanJobs } from "@/db/schema";
import { PRESET_HASHTAGS, PRESET_KEYWORDS, PRESET_CREATORS } from "./discovery-keywords";
import { dedupeVideos } from "./tiktok-providers";
import { bimzSearch, bimzLatest } from "./bimz-preset-provider";
import { upsertVideo } from "./preset-store";

/* =========================================================================
 * Bulk harvest — walks the whole keyword/hashtag/creator space of the Bimz
 * preset index and ingests EVERY unique preset video it returns, exactly the
 * way the reference index surfaces them. Deduplicated by TikTok id.
 * =======================================================================*/

export type HarvestProgress = {
  keyword: string;
  found: number;
  total: number;
  index: number;
  of: number;
};

export type HarvestReport = {
  queries: { query: string; found: number; ingested: number; duplicates: number }[];
  totalFound: number;
  totalIngested: number;
  totalDuplicates: number;
  queriesRun: number;
  providerMessages: string[];
};

/** Runs the full harvest. `maxQueries` caps how much of the space is walked. */
export async function runBulkHarvest(options: {
  maxQueries?: number;
  perQuery?: number;
  jobId?: string;
  includeCreators?: boolean;
} = {}): Promise<HarvestReport> {
  const perQuery = options.perQuery ?? 60;
  // Creators first so FYP fills with real AM preset accounts (e.g. @arullzzxyz)
  const queries: string[] = [
    ...(options.includeCreators === false ? [] : PRESET_CREATORS),
    ...PRESET_KEYWORDS,
    ...PRESET_HASHTAGS,
  ];
  const capped = queries.slice(0, options.maxQueries ?? queries.length);

  const report: HarvestReport = {
    queries: [],
    totalFound: 0,
    totalIngested: 0,
    totalDuplicates: 0,
    queriesRun: 0,
    providerMessages: [],
  };

  for (const query of capped) {
    const result = await bimzSearch(query, perQuery);
    report.queriesRun += 1;
    if (!result.ok) {
      if (!report.providerMessages.includes(result.message)) report.providerMessages.push(result.message);
      report.queries.push({ query, found: 0, ingested: 0, duplicates: 0 });
      continue;
    }

    const unique = dedupeVideos(result.videos);
    let ingested = 0;
    let duplicates = 0;

    for (const video of unique) {
      const existing = await db
        .select({ id: presets.id })
        .from(presets)
        .where(eq(presets.tiktokId, video.tiktokId))
        .limit(1);
      if (existing[0]) {
        duplicates += 1;
        await upsertVideo(video, "bimz_harvest"); // refresh live media URL + stats
        continue;
      }
      await upsertVideo(video, "bimz_harvest");
      ingested += 1;
    }

    report.totalFound += unique.length;
    report.totalIngested += ingested;
    report.totalDuplicates += duplicates;
    report.queries.push({ query, found: unique.length, ingested, duplicates });

    await db.insert(scanAttempts).values({
      jobId: options.jobId ?? null,
      stage: "bulk_harvest",
      provider: "restapi-bimz",
      ok: true,
      message: `"${query}": ${unique.length} video, ${ingested} baru, ${duplicates} duplikat`,
      evidence: { query, found: unique.length, ingested, duplicates },
    });
  }

  return report;
}

/**
 * Auto-seed. Called by the listing endpoints so a freshly deployed (empty)
 * database fills itself instead of showing an empty page — this is what makes
 * presets "reappear" after a new deploy or a database swap.
 */
export async function ensureSeeded(): Promise<{ seeded: boolean; reason: string; ingested?: number }> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(presets);

  if (Number(count) > 0) return { seeded: false, reason: `database sudah berisi ${count} preset` };

  const latest = await bimzLatest(80);
  if (!latest.ok || latest.videos.length === 0) {
    return { seeded: false, reason: `tidak dapat menarik data awal: ${latest.message}` };
  }

  const unique = dedupeVideos(latest.videos);
  let ingested = 0;
  for (const video of unique) {
    await upsertVideo(video, "auto_seed");
    ingested += 1;
  }

  await db.insert(scanAttempts).values({
    stage: "auto_seed",
    provider: "restapi-bimz",
    ok: true,
    message: `Auto-seed: ${ingested} preset dimasukkan ke database kosong`,
    evidence: { ingested },
  });

  return { seeded: true, reason: "database kosong → auto-seed dijalankan", ingested };
}

/** Kicks off a full harvest as a queued job (safe to call from a request). */
export async function startHarvestJob(maxQueries?: number): Promise<string> {
  const rows = await db
    .insert(scanJobs)
    .values({
      type: "bulk_harvest",
      payload: { maxQueries: maxQueries ?? null, triggeredBy: "panel" },
      provider: "restapi-bimz",
      status: "queued",
    })
    .returning({ id: scanJobs.id });
  return rows[0]!.id;
}


/* =========================================================================
 * Bulk deep scan — runs the REAL Bimz scanner over presets that still have no
 * verified preset file. Works identically on Vercel because every call is a
 * plain HTTPS request with a short, bounded batch size.
 * =======================================================================*/

export type DeepScanBatchReport = {
  scanned: number;
  withXml: number;
  withPackage: number;
  empty: number;
  failed: number;
  rateLimited: number;
  stoppedEarly: boolean;
  durationMs: number;
  details: { tiktokId: string; status: string; xml: number; packages: number; message: string }[];
};

export async function runDeepScanBatch(limit = 8, jobId?: string): Promise<DeepScanBatchReport> {
  const started = Date.now();
  const { scanPreset } = await import("./preset-store");

  // Prefer presets that have never produced a verified link yet.
  const rows = await db
    .select({ id: presets.id, tiktokId: presets.tiktokId })
    .from(presets)
    .where(
      sql`${presets.overallStatus} <> 'COMPLETE' and ${presets.scanAttempts} < 6`,
    )
    .orderBy(sql`${presets.scanAttempts} asc, ${presets.lastScannedAt} asc nulls first`)
    .limit(Math.min(Math.max(limit, 1), 25));

  const report: DeepScanBatchReport = {
    scanned: 0,
    withXml: 0,
    withPackage: 0,
    empty: 0,
    failed: 0,
    rateLimited: 0,
    stoppedEarly: false,
    durationMs: 0,
    details: [],
  };

  const pace = Number(process.env.DEEP_SCAN_PACE_MS ?? 1200);
  let rateLimitHits = 0;

  for (const [index, row] of rows.entries()) {
    // Space the upstream calls out so a batch never trips the shared quota.
    if (index > 0 && pace > 0) await new Promise((resolve) => setTimeout(resolve, pace));

    try {
      const result = await scanPreset(row.id, jobId);
      report.scanned += 1;

      const deepMsg = result.stages.find((stage) => stage.stage === "bimz_deep_scan")?.message ?? "";
      if (/kuota|limit/i.test(deepMsg)) {
        rateLimitHits += 1;
        report.rateLimited += 1;
        // Back off hard, then stop the batch instead of wasting the quota.
        if (rateLimitHits >= 2) {
          report.stoppedEarly = true;
          report.details.push({
            tiktokId: row.tiktokId,
            status: "RATE_LIMITED",
            xml: 0,
            packages: 0,
            message: "Batch dihentikan: kuota RestAPI Bimz tercapai, preset dijadwalkan ulang otomatis.",
          });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      const xml = result.xmlStatus === "FOUND" ? 1 : 0;
      const pack = result.fiveMbStatus === "FOUND" ? 1 : 0;
      report.withXml += xml;
      report.withPackage += pack;
      if (!xml && !pack) report.empty += 1;
      report.details.push({
        tiktokId: row.tiktokId,
        status: result.overallStatus,
        xml,
        packages: pack,
        message: result.stages.find((stage) => stage.stage === "bimz_deep_scan")?.message ?? "",
      });
    } catch (error) {
      report.failed += 1;
      report.details.push({
        tiktokId: row.tiktokId,
        status: "FAILED",
        xml: 0,
        packages: 0,
        message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      });
    }
  }

  report.durationMs = Date.now() - started;

  await db.insert(scanAttempts).values({
    jobId: jobId ?? null,
    stage: "deep_scan_batch",
    provider: "restapi-bimz/alight",
    ok: report.withXml + report.withPackage > 0,
    message: `Deep scan batch: ${report.scanned} preset, ${report.withXml} XML, ${report.withPackage} paket, ${report.empty} kosong, ${report.failed} gagal, ${report.rateLimited} kena kuota${report.stoppedEarly ? " (dihentikan lebih awal)" : ""}`,
    evidence: { ...report, details: report.details.slice(0, 10) },
  });

  return report;
}


/**
 * Backfill — promotes links we ALREADY hold in preset_links into the preset's
 * status columns. Pure SQL, instant, and safe to run repeatedly. This is what
 * stops a preset from showing "belum ditemukan" when a real URL is on file.
 */
export async function backfillStatuses(): Promise<{ xml: number; fiveMb: number; complete: number }> {
  await db.execute(sql`
    with best as (
      select distinct on (preset_id, kind) preset_id, kind, url, source_type, confidence
      from spaceprs.preset_links
      where confidence > 0
      order by preset_id, kind, confidence desc, created_at asc
    ),
    agg as (
      select
        preset_id,
        max(case when kind = 'xml' then url end) as xml_url,
        max(case when kind = 'xml' then source_type end) as xml_source,
        max(case when kind = 'xml' then confidence end) as xml_conf,
        max(case when kind = 'five_mb' then url end) as five_url,
        max(case when kind = 'five_mb' then source_type end) as five_source,
        max(case when kind = 'five_mb' then confidence end) as five_conf
      from best
      group by preset_id
    )
    update spaceprs.presets p
    set
      xml_url        = coalesce(p.xml_url, a.xml_url),
      five_mb_url    = coalesce(p.five_mb_url, a.five_url),
      xml_source     = coalesce(p.xml_source, a.xml_source),
      five_mb_source = coalesce(p.five_mb_source, a.five_source),
      xml_status     = case when a.xml_url  is not null then 'FOUND' else p.xml_status end,
      five_mb_status = case when a.five_url is not null then 'FOUND' else p.five_mb_status end,
      confidence     = greatest(p.confidence, coalesce(a.xml_conf, 0), coalesce(a.five_conf, 0)),
      overall_status = case
        when a.xml_url is not null and a.five_url is not null then 'COMPLETE'
        when a.xml_url is not null then 'XML_FOUND'
        when a.five_url is not null then 'FIVE_MB_FOUND'
        else p.overall_status
      end,
      updated_at = now()
    from agg a
    where a.preset_id = p.id
  `);

  const [row] = await db
    .execute<{ xml: number; five: number; complete: number }>(sql`
      select
        count(*) filter (where xml_status = 'FOUND')::int as xml,
        count(*) filter (where five_mb_status = 'FOUND')::int as five,
        count(*) filter (where overall_status = 'COMPLETE')::int as complete
      from spaceprs.presets
    `)
    .then((result) => result.rows);

  return {
    xml: Number(row?.xml ?? 0),
    fiveMb: Number(row?.five ?? 0),
    complete: Number(row?.complete ?? 0),
  };
}


/**
 * Pull as many presets as possible from the Bimz upstream index
 * (https://3000-iptlrbb0xhnl0yfm0kz1x.e2b.app) by walking keywords with high limits.
 */
export async function syncAllFromUpstream(options: {
  maxQueries?: number;
  perQuery?: number;
  jobId?: string;
} = {}): Promise<HarvestReport> {
  return runBulkHarvest({
    maxQueries: options.maxQueries ?? 200,
    perQuery: options.perQuery ?? 80,
    includeCreators: true,
    jobId: options.jobId,
  });
}
