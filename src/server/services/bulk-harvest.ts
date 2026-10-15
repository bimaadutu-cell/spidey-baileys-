import { eq, inArray, sql } from "drizzle-orm";
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

  // Queries run in parallel (bounded) — the upstream index is the slow part, not our DB.
  const concurrency = Math.min(Math.max(Number(process.env.BULK_HARVEST_CONCURRENCY ?? 4), 1), 8);
  const perQueryResults: HarvestReport["queries"][number][] = new Array(capped.length);
  let cursor = 0;

  const runOne = async (query: string, slot: number) => {
    const result = await bimzSearch(query, perQuery);
    report.queriesRun += 1;
    if (!result.ok) {
      if (!report.providerMessages.includes(result.message)) report.providerMessages.push(result.message);
      perQueryResults[slot] = { query, found: 0, ingested: 0, duplicates: 0 };
      return;
    }

    const unique = dedupeVideos(result.videos);
    // ONE query tells us which videos already exist (was: one SELECT per video).
    const ids = unique.map((video) => video.tiktokId);
    const existingRows = ids.length
      ? await db.select({ tiktokId: presets.tiktokId }).from(presets).where(inArray(presets.tiktokId, ids))
      : [];
    const known = new Set(existingRows.map((row) => row.tiktokId));
    const duplicates = unique.filter((video) => known.has(video.tiktokId)).length;
    const ingested = unique.length - duplicates;

    // Upsert in small parallel groups (also refreshes live media URL + stats of known rows).
    for (let i = 0; i < unique.length; i += 6) {
      await Promise.all(unique.slice(i, i + 6).map((video) => upsertVideo(video, "bimz_harvest").catch(() => undefined)));
    }

    report.totalFound += unique.length;
    report.totalIngested += ingested;
    report.totalDuplicates += duplicates;
    perQueryResults[slot] = { query, found: unique.length, ingested, duplicates };

    await db
      .insert(scanAttempts)
      .values({
        jobId: options.jobId ?? null,
        stage: "bulk_harvest",
        provider: "restapi-bimz",
        ok: true,
        message: `"${query}": ${unique.length} video, ${ingested} baru, ${duplicates} duplikat`,
        evidence: { query, found: unique.length, ingested, duplicates },
      })
      .catch(() => undefined);
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, capped.length) }, async () => {
      while (cursor < capped.length) {
        const slot = cursor++;
        try {
          await runOne(capped[slot]!, slot);
        } catch (error) {
          perQueryResults[slot] = { query: capped[slot]!, found: 0, ingested: 0, duplicates: 0 };
          const message = error instanceof Error ? error.message.slice(0, 120) : "harvest error";
          if (!report.providerMessages.includes(message)) report.providerMessages.push(message);
        }
      }
    }),
  );
  report.queries.push(...perQueryResults.filter(Boolean));

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

/** Sequential background queue: archiving big videos must never block scanning. */
let archiveChain: Promise<unknown> = Promise.resolve();
function queueArchive(presetId: string, tiktokId: string): void {
  archiveChain = archiveChain
    .then(async () => {
      const { resolvePlayableUrl } = await import("./media-proxy");
      const { storeVideo } = await import("./video-store");
      const media = await resolvePlayableUrl(presetId);
      if (media.url) await storeVideo(presetId, tiktokId, media.url);
    })
    .catch(() => undefined);
}

export async function runDeepScanBatch(limit = 8, jobId?: string): Promise<DeepScanBatchReport> {
  const started = Date.now();
  const { scanPreset } = await import("./preset-store");

  // Bimz never gives up: presets without any found link are scanned first and
  // retried forever (spaced by nextRetryAt). Uploads are never re-scanned.
  const rows = await db
    .select({ id: presets.id, tiktokId: presets.tiktokId })
    .from(presets)
    .where(
      sql`${presets.overallStatus} <> 'COMPLETE'
        and ${presets.discoverySource} is distinct from 'user_upload'
        and (${presets.nextRetryAt} is null or ${presets.nextRetryAt} <= now())
        and not (${presets.overallStatus} = 'SCANNING' and ${presets.lastScannedAt} > now() - interval '3 minutes')`,
    )
    .orderBy(
      sql`(case when ${presets.xmlStatus} = 'FOUND' or ${presets.fiveMbStatus} = 'FOUND' then 1 else 0 end) asc`,
      sql`${presets.lastScannedAt} asc nulls first`,
    )
    .limit(Math.min(Math.max(limit, 1), 100));

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

  // Parallel workers with staggered starts: fast, but never a burst that trips the shared quota.
  const concurrency = Math.min(Math.max(Number(process.env.DEEP_SCAN_CONCURRENCY ?? 4), 1), 8);
  const pace = Number(process.env.DEEP_SCAN_PACE_MS ?? 250);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let cursor = 0;
  let rateLimitHits = 0;
  let stop = false;
  let nextSlot = Date.now();

  const worker = async () => {
    while (!stop) {
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index]!;

      const slot = Math.max(Date.now(), nextSlot);
      nextSlot = slot + pace;
      if (slot > Date.now()) await sleep(slot - Date.now());
      if (stop) return;

      try {
        const result = await scanPreset(row.id, jobId);
        report.scanned += 1;

        // Permanent video archive in PostgreSQL — in the background so it never slows the scan.
        queueArchive(row.id, row.tiktokId);

        const deepMsg = result.stages.find((stage) => stage.stage === "bimz_deep_scan")?.message ?? "";
        if (/kuota|limit/i.test(deepMsg)) {
          rateLimitHits += 1;
          report.rateLimited += 1;
          if (rateLimitHits >= 2) {
            stop = true;
            report.stoppedEarly = true;
            report.details.push({
              tiktokId: row.tiktokId,
              status: "RATE_LIMITED",
              xml: 0,
              packages: 0,
              message: "Batch dihentikan: kuota RestAPI Bimz tercapai, preset dijadwalkan ulang otomatis.",
            });
            return;
          }
          await sleep(5000);
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
          message: deepMsg,
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
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));

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
 * (https://3000-ir16hc49vxg3lo8c3r0qc.e2b.app) by walking keywords with high limits.
 */
export async function syncAllFromUpstream(options: {
  maxQueries?: number;
  perQuery?: number;
  jobId?: string;
} = {}): Promise<HarvestReport> {
  return runBulkHarvest({
    maxQueries: options.maxQueries ?? 300,
    perQuery: options.perQuery ?? 80,
    includeCreators: true,
    jobId: options.jobId,
  });
}
