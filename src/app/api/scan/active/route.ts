import { json } from "@/server/http";
import { activeScans } from "@/server/services/scan-progress";
import { keyPoolStatus } from "@/server/services/bimz-deep-scanner";

export const dynamic = "force-dynamic";

/** Lightweight polling endpoint: which presets are being scanned right now. */
export async function GET() {
  const scans = activeScans();
  return json({
    ok: true,
    count: scans.length,
    scans: scans.map((scan) => ({
      presetId: scan.presetId,
      tiktokId: scan.tiktokId,
      phase: scan.phase,
      label: scan.label,
      elapsedSec: Math.round((Date.now() - scan.startedAt) / 1000),
    })),
    apiKeys: keyPoolStatus(),
  });
}
