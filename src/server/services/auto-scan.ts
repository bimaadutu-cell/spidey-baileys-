import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { presets } from "@/db/schema";
import { runBulkHarvest, runDeepScanBatch } from "./bulk-harvest";

/**
 * Background auto-research — two lanes, both running forever after boot:
 *
 *  FAST LANE (real time)  every AUTO_SCAN_FAST_SEC (default 15 s)
 *    - every AUTO_SCAN_LATEST_SEC (default 60 s) pulls the NEWEST presets from the
 *      Bimz index, so a new TikTok preset shows up within about a minute
 *    - deep-scans a small batch (AUTO_SCAN_FAST_BATCH, default 8) of presets that
 *      still have no verified XML / 5MB — never-scanned ones first
 *
 *  FULL ROUND (wide net)  every AUTO_SCAN_INTERVAL_MIN (default 3 min)
 *    - harvest creators / keywords / hashtags (dedupe by TikTok id)
 *    - bigger deep-scan batch (AUTO_SCAN_DEEP, default 20)
 *
 * The lanes have separate locks, so a long harvest never delays the fast lane.
 * All scans run in parallel workers (DEEP_SCAN_CONCURRENCY, default 4).
 *
 * Env:
 *   AUTO_SCAN_ENABLED       "false" to turn everything off (default on)
 *   AUTO_SCAN_FAST_SEC      fast lane period in seconds (default 15, min 5)
 *   AUTO_SCAN_LATEST_SEC    how often the fast lane pulls newest presets (default 60)
 *   AUTO_SCAN_FAST_BATCH    deep-scan batch per fast tick (default 8)
 *   AUTO_SCAN_INTERVAL_MIN  minutes between full rounds (default 3, min 1)
 *   AUTO_SCAN_QUERIES       queries per full round (default 40)
 *   AUTO_SCAN_DEEP          deep-scan batch per full round (default 20)
 */
const g = globalThis as unknown as {
  __autoScanStarted?: boolean;
  __autoScanRunning?: boolean;
  __fastScanRunning?: boolean;
  __lastLatestAt?: number;
};

function num(name: string, fallback: number, min = 1): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export async function runAutoScanRound(): Promise<void> {
  if (g.__autoScanRunning) return;
  g.__autoScanRunning = true;
  try {
    const harvest = await runBulkHarvest({
      maxQueries: num("AUTO_SCAN_QUERIES", 40),
      perQuery: 40,
      includeCreators: true,
    });
    const deep = await runDeepScanBatch(num("AUTO_SCAN_DEEP", 20, 0));
    console.log(
      `[auto-scan] baru=${harvest.totalIngested} duplikat=${harvest.totalDuplicates} deep=${deep.scanned} xml=${deep.withXml}`,
    );
  } catch (error) {
    console.error("[auto-scan] round failed:", error instanceof Error ? error.message : error);
  } finally {
    g.__autoScanRunning = false;
  }
}

/** Pulls the newest presets from the Bimz index and stores them. Returns how many were NEW. */
async function pullLatest(): Promise<number> {
  const { bimzLatest } = await import("./bimz-preset-provider");
  const { dedupeVideos } = await import("./tiktok-providers");
  const { upsertVideo } = await import("./preset-store");
  const result = await bimzLatest(60);
  if (!result.ok) return 0;
  const videos = dedupeVideos(result.videos);
  if (videos.length === 0) return 0;

  const existing = await db
    .select({ tiktokId: presets.tiktokId })
    .from(presets)
    .where(inArray(presets.tiktokId, videos.map((video) => video.tiktokId)));
  const known = new Set(existing.map((row) => row.tiktokId));

  for (let i = 0; i < videos.length; i += 6) {
    await Promise.all(videos.slice(i, i + 6).map((video) => upsertVideo(video, "bimz_latest").catch(() => null)));
  }
  return videos.filter((video) => !known.has(video.tiktokId)).length;
}

export async function runFastLane(): Promise<void> {
  if (g.__fastScanRunning) return;
  g.__fastScanRunning = true;
  try {
    let pulled = 0;
    const latestEvery = num("AUTO_SCAN_LATEST_SEC", 60, 10) * 1000;
    if (Date.now() - (g.__lastLatestAt ?? 0) >= latestEvery) {
      g.__lastLatestAt = Date.now();
      pulled = await pullLatest().catch(() => 0);
    }
    const deep = await runDeepScanBatch(num("AUTO_SCAN_FAST_BATCH", 8));
    if (pulled > 0 || deep.withXml > 0 || deep.withPackage > 0) {
      console.log(`[auto-scan:fast] baru=${pulled} deep=${deep.scanned} xml=${deep.withXml} 5mb=${deep.withPackage}`);
    }
  } catch (error) {
    // The DB may not be configured yet (env still being edited) — just try again next tick.
    console.error("[auto-scan:fast] tick failed:", error instanceof Error ? error.message : error);
  } finally {
    g.__fastScanRunning = false;
  }
}

export function startAutoScan(): void {
  if (g.__autoScanStarted) return;
  if ((process.env.AUTO_SCAN_ENABLED ?? "true").toLowerCase() === "false") return;
  g.__autoScanStarted = true;

  const intervalMs = num("AUTO_SCAN_INTERVAL_MIN", 3, 1) * 60_000;
  const fastMs = num("AUTO_SCAN_FAST_SEC", 15, 5) * 1000;

  setTimeout(() => void runFastLane(), 5_000);
  setTimeout(() => void runAutoScanRound(), 12_000);
  const fast = setInterval(() => void runFastLane(), fastMs);
  const full = setInterval(() => void runAutoScanRound(), intervalMs);
  fast.unref?.();
  full.unref?.();
  console.log(`[auto-scan] aktif — jalur cepat tiap ${fastMs / 1000}s, putaran penuh tiap ${intervalMs / 60000} menit`);
}
