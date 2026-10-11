import { NextRequest } from "next/server";
import { json, fail } from "@/server/http";
import { runBulkHarvest, runDeepScanBatch, syncAllFromUpstream } from "@/server/services/bulk-harvest";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily Bimz scan ~300 presets.
 * Protect with CRON_SECRET header: Authorization: Bearer <CRON_SECRET>
 * Or INTERNAL_TOKEN.
 * Schedule on Railway cron / external cron once per day.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const expected = (process.env.CRON_SECRET || config.internalToken || "").trim();
  if (!expected || token !== expected) {
    return fail("Unauthorized", 401);
  }

  const harvest = await syncAllFromUpstream({ maxQueries: 300, perQuery: 100 }).catch(async () =>
    runBulkHarvest({ maxQueries: 300, perQuery: 100 }),
  );
  const deep = await runDeepScanBatch(50);

  return json({
    ok: true,
    message: "Daily scan 300 selesai",
    harvest,
    deep,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
