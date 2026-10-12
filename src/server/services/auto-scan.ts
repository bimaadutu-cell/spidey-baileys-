import { runBulkHarvest, runDeepScanBatch } from "./bulk-harvest";

/**
 * Background auto-research.
 * Starts once when the server boots and repeats forever:
 *   1. harvest — walk creators/keywords/hashtags, ingest only NEW presets
 *      (dedupe by TikTok id is done inside the harvest, so nothing doubles).
 *   2. deep scan — look for XML / 5MB links on presets still missing them.
 * New rows land in PostgreSQL, and the homepage picks them up automatically.
 *
 * Env:
 *   AUTO_SCAN_ENABLED      "false" to turn off (default on)
 *   AUTO_SCAN_INTERVAL_MIN minutes between rounds (default 10, min 2)
 *   AUTO_SCAN_QUERIES      queries per round (default 40)
 *   AUTO_SCAN_DEEP         deep-scan batch size per round (default 20)
 */
const g = globalThis as unknown as { __autoScanStarted?: boolean; __autoScanRunning?: boolean };

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
    console.error("[auto-scan] round failed:", error);
  } finally {
    g.__autoScanRunning = false;
  }
}

export function startAutoScan(): void {
  if (g.__autoScanStarted) return;
  if ((process.env.AUTO_SCAN_ENABLED ?? "true").toLowerCase() === "false") return;
  g.__autoScanStarted = true;

  const intervalMs = num("AUTO_SCAN_INTERVAL_MIN", 10, 2) * 60_000;
  // first round shortly after boot, then on a fixed interval
  setTimeout(() => void runAutoScanRound(), 20_000);
  const timer = setInterval(() => void runAutoScanRound(), intervalMs);
  timer.unref?.();
  console.log(`[auto-scan] aktif, tiap ${intervalMs / 60000} menit`);
}
