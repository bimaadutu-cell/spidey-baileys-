import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { presets } from "@/db/schema";
import { resolvePlayableUrl, streamMedia } from "@/server/services/media-proxy";
import { archiveInBackground, getStoredVideo, serveStoredVideo } from "@/server/services/video-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Video gateway with permanent storage.
 *
 *   1. Already archived  → serve bytes straight from PostgreSQL (never expires)
 *   2. Otherwise         → resolve a live CDN url, stream it through, and
 *                          archive it in the background so the next play is
 *                          served from the database.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ ok: false, error: "ID preset tidak valid" }, { status: 400 });
  }

  const range = req.headers.get("range");

  // 1. permanent copy
  const stored = await getStoredVideo(id);
  if (stored) return serveStoredVideo(stored, range);

  // 2. live resolve
  const resolved = await resolvePlayableUrl(id);
  if (!resolved.url) {
    return Response.json(
      { ok: false, error: resolved.error ?? "URL video tidak tersedia", providers: resolved.providers },
      { status: 404 },
    );
  }

  // Archive once so this preset becomes permanent.
  const rows = await db.select({ tiktokId: presets.tiktokId }).from(presets).where(eq(presets.id, id)).limit(1);
  if (rows[0]) archiveInBackground(id, rows[0].tiktokId, resolved.url);

  // Proxy the bytes (keeps the player on our origin, no CORS/hotlink issues).
  return streamMedia(resolved.url, range);
}
