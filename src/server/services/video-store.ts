import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { presets, videoAssets } from "@/db/schema";
import { isDirectCdnUrl } from "./media-proxy";

/* =========================================================================
 * Permanent video storage.
 *
 * TikTok CDN links expire within hours. Once a preset has actually been
 * watched we download the mp4 once and keep the bytes in PostgreSQL, so the
 * preset stays playable forever — no re-resolve, no dead link, no embed.
 *
 * Served back by /api/media/video/<id> with full Range support.
 * =======================================================================*/

const MAX_BYTES = Number(process.env.VIDEO_CACHE_MAX_BYTES ?? 25_000_000); // 25 MB permanent cache
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const inflight = new Set<string>();

export type StoredVideo = { data: Buffer; contentType: string; sizeBytes: number };

export async function getStoredVideo(presetId: string): Promise<StoredVideo | null> {
  const rows = await db
    .select({ data: videoAssets.data, contentType: videoAssets.contentType, sizeBytes: videoAssets.sizeBytes })
    .from(videoAssets)
    .where(eq(videoAssets.presetId, presetId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    data: Buffer.from(row.data, "base64"),
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  };
}

export async function hasStoredVideo(presetId: string): Promise<boolean> {
  const rows = await db
    .select({ id: videoAssets.id })
    .from(videoAssets)
    .where(eq(videoAssets.presetId, presetId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Downloads a CDN url once and persists it. Safe to call repeatedly:
 * duplicates are ignored and concurrent calls are de-duplicated.
 */
export async function storeVideo(
  presetId: string,
  tiktokId: string,
  cdnUrl: string,
): Promise<{ stored: boolean; reason: string; sizeBytes?: number }> {
  const looksVideo =
    isDirectCdnUrl(cdnUrl) ||
    /\.(mp4|webm|mov)(\?|$)/i.test(cdnUrl) ||
    /\/api\/media/i.test(cdnUrl) ||
    /tiktokcdn|byteoversea|ibyteimg|tikwm/i.test(cdnUrl);
  if (!looksVideo) return { stored: false, reason: "URL bukan sumber video" };
  if (inflight.has(presetId)) return { stored: false, reason: "unduhan sedang berjalan" };
  if (await hasStoredVideo(presetId)) return { stored: false, reason: "sudah tersimpan" };

  inflight.add(presetId);
  try {
    const res = await fetch(cdnUrl, {
      headers: { "user-agent": UA, referer: "https://www.tiktok.com/", accept: "*/*" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { stored: false, reason: `CDN HTTP ${res.status}` };

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) {
      return { stored: false, reason: `video terlalu besar (${Math.round(declared / 1_000_000)}MB)` };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return { stored: false, reason: "respons kosong" };
    if (buffer.length > MAX_BYTES) {
      return { stored: false, reason: `video terlalu besar (${Math.round(buffer.length / 1_000_000)}MB)` };
    }

    await db
      .insert(videoAssets)
      .values({
        presetId,
        tiktokId,
        data: buffer.toString("base64"),
        contentType: res.headers.get("content-type")?.split(";")[0] ?? "video/mp4",
        sizeBytes: buffer.length,
        sourceUrl: cdnUrl.slice(0, 900),
      })
      .onConflictDoNothing({ target: videoAssets.presetId });

    await db
      .update(presets)
      .set({ playableSource: "stored", updatedAt: new Date() })
      .where(eq(presets.id, presetId));

    return { stored: true, reason: "tersimpan permanen", sizeBytes: buffer.length };
  } catch (error) {
    return { stored: false, reason: error instanceof Error ? error.message.slice(0, 140) : "unduh gagal" };
  } finally {
    inflight.delete(presetId);
  }
}

/** Fire-and-forget archive used right after a video is watched. */
export function archiveInBackground(presetId: string, tiktokId: string, cdnUrl: string): void {
  void storeVideo(presetId, tiktokId, cdnUrl).catch(() => undefined);
}

/** Serves stored bytes with Range support (identical semantics to a CDN). */
export function serveStoredVideo(video: StoredVideo, rangeHeader: string | null): Response {
  const total = video.data.length;
  const headers = new Headers({
    "content-type": video.contentType,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "cross-origin-resource-policy": "cross-origin",
  });

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (Number.isFinite(start) && start <= end && start < total) {
        const chunk = video.data.subarray(start, end + 1);
        headers.set("content-range", `bytes ${start}-${end}/${total}`);
        headers.set("content-length", String(chunk.length));
        return new Response(new Uint8Array(chunk), { status: 206, headers });
      }
    }
  }

  headers.set("content-length", String(total));
  return new Response(new Uint8Array(video.data), { status: 200, headers });
}

export async function videoCacheStats(): Promise<{ count: number; totalMb: number }> {
  const [row] = await db
    .execute<{ n: number; bytes: number }>(
      sql`select count(*)::int as n, coalesce(sum(size_bytes), 0)::bigint as bytes from spaceprs.video_assets`,
    )
    .then((result) => result.rows);
  return {
    count: Number(row?.n ?? 0),
    totalMb: Math.round((Number(row?.bytes ?? 0) / 1_000_000) * 10) / 10,
  };
}
