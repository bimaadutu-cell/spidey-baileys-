import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { presets } from "@/db/schema";
import { clientIp, fail, json, rateLimit } from "@/server/http";
import { scanPreset } from "@/server/services/preset-store";
import { beginScan, isScanning, scanLabel } from "@/server/services/scan-progress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * On-view auto scan — the behaviour the reference site has:
 * when a video becomes the active item in the feed, the player asks the server
 * to scan THAT preset with the real Bimz scanner. The UI shows
 * "Sedang scan preset…" until the scan returns a real answer.
 *
 * GET  → current state (cheap, used for polling)
 * POST → trigger a real scan (idempotent while one is already running)
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("ID preset tidak valid", 400);

  const rows = await db
    .select({
      xmlStatus: presets.xmlStatus,
      fiveMbStatus: presets.fiveMbStatus,
      overallStatus: presets.overallStatus,
      confidence: presets.confidence,
      xmlUrl: presets.xmlUrl,
      fiveMbUrl: presets.fiveMbUrl,
      lastScannedAt: presets.lastScannedAt,
      scanAttempts: presets.scanAttempts,
    })
    .from(presets)
    .where(eq(presets.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return fail("Preset tidak ditemukan", 404);

  const scanning = isScanning(id);
  return json({
    ok: true,
    scanning,
    label: scanning ? scanLabel(id) : null,
    ...row,
    overallStatus: scanning ? "SCANNING" : row.overallStatus,
    lastScannedAt: row.lastScannedAt ? row.lastScannedAt.toISOString() : null,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("ID preset tidak valid", 400);

  // Generous but bounded: a scrolling feed may legitimately touch many videos.
  if (!rateLimit(`viewscan:${clientIp(req)}`, 40, 60_000)) {
    return json({ ok: true, scanning: false, skipped: "rate-limited" });
  }

  if (isScanning(id)) {
    return json({ ok: true, scanning: true, label: scanLabel(id), already: true });
  }

  const rows = await db
    .select({
      id: presets.id,
      tiktokId: presets.tiktokId,
      overallStatus: presets.overallStatus,
      scanAttempts: presets.scanAttempts,
      lastScannedAt: presets.lastScannedAt,
    })
    .from(presets)
    .where(eq(presets.id, id))
    .limit(1);

  const preset = rows[0];
  if (!preset) return fail("Preset tidak ditemukan", 404);

  // Already complete and scanned recently → nothing to do.
  const scannedRecently =
    preset.lastScannedAt !== null && Date.now() - preset.lastScannedAt.getTime() < 6 * 3600_000;
  if (preset.overallStatus === "COMPLETE" && scannedRecently) {
    return json({ ok: true, scanning: false, skipped: "sudah lengkap" });
  }
  if (preset.scanAttempts >= 8) {
    return json({ ok: true, scanning: false, skipped: "batas percobaan tercapai" });
  }

  // Mark immediately so the very next poll already shows "Sedang scan preset…".
  beginScan(preset.id, preset.tiktokId);

  // Run detached: the player must not wait for the upstream parse to finish.
  void scanPreset(preset.id).catch(() => undefined);

  return json({ ok: true, scanning: true, label: scanLabel(id) ?? "Sedang scan preset…", started: true });
}
