import { eq } from "drizzle-orm";
import { db } from "@/db";
import { presets } from "@/db/schema";
import { config } from "../config";
import { isSafePublicUrl } from "../http";
import { fetchVideoMetadata } from "./tiktok-providers";

/* =========================================================================
 * Real-time media gateway (mirrors how the reference site serves video)
 * -----------------------------------------------------------------------
 * The reference resolves a *direct TikTok CDN url* for each video and lets
 * the browser stream from the CDN. We do exactly the same:
 *
 *   1. Bimz deep scanner  -> data.tiktok.video  (direct CDN, always fresh)
 *   2. tikwm metadata     -> data.play          (direct CDN, fallback)
 *   3. 302 the browser to that CDN url
 *
 * We never store or serve another site's /api/media proxy url: chaining two
 * proxies is what produced "overload-protect triggered" and 404s.
 * =======================================================================*/

const MEDIA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Hosts we are willing to stream/redirect to. */
const MEDIA_HOST_ALLOWLIST = [
  /(^|\.)tiktokcdn(-us|-eu)?\.com$/i,
  /(^|\.)tiktokv\.(com|us)$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)byteoversea\.com$/i,
  /(^|\.)ibyteimg\.com$/i,
  /(^|\.)akamaized\.net$/i,
  /(^|\.)muscdn\.com$/i,
  /(^|\.)tikwm\.com$/i,
  /(^|\.)firebasestorage\.googleapis\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
];

/** A real, directly playable CDN url (not somebody else's proxy endpoint). */
export function isDirectCdnUrl(url: string | null | undefined): url is string {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  if (/\/api\/media\b/i.test(url)) return false; // another site's proxy
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return MEDIA_HOST_ALLOWLIST.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

export function isAllowedMediaHost(rawUrl: string): { ok: boolean; reason?: string } {
  const safety = isSafePublicUrl(rawUrl);
  if (!safety.ok) return { ok: false, reason: safety.reason };
  const host = safety.url!.hostname.replace(/^www\./, "").toLowerCase();
  let upstreamHost = "";
  try {
    if (config.bimz.upstreamUrl) upstreamHost = new URL(config.bimz.upstreamUrl).hostname.replace(/^www\./, "");
  } catch {
    upstreamHost = "";
  }
  const allowed =
    MEDIA_HOST_ALLOWLIST.some((pattern) => pattern.test(host)) ||
    (upstreamHost && (host === upstreamHost || host.endsWith(`.${upstreamHost}`)));
  if (!allowed) return { ok: false, reason: `Host media tidak diizinkan: ${host}` };
  return { ok: true };
}

export type ResolvedMedia = {
  url: string | null;
  source: string;
  refreshed: boolean;
  providers: { provider: string; ok: boolean; message: string }[];
  error?: string;
};

/** Short in-process cache so a feed scrolling past 10 cards never stampedes. */
const inflight = new Map<string, Promise<ResolvedMedia>>();

async function resolveFresh(presetId: string): Promise<ResolvedMedia> {
  const rows = await db.select().from(presets).where(eq(presets.id, presetId)).limit(1);
  const preset = rows[0];
  if (!preset) {
    return { url: null, source: "none", refreshed: false, providers: [], error: "Preset tidak ditemukan" };
  }

  const stored = preset.playableUrl;
  const storedUsable = isDirectCdnUrl(stored);
  const fresh =
    storedUsable &&
    preset.playableExpiresAt !== null &&
    preset.playableExpiresAt.getTime() > Date.now() + 60_000;

  if (fresh) {
    return { url: stored!, source: preset.playableSource ?? "cache", refreshed: false, providers: [] };
  }

  const providers: ResolvedMedia["providers"] = [];

  // 1) Bimz deep scanner — same source the reference uses; always a live CDN url.
  if (config.bimz.enabled) {
    try {
      const { bimzDeepScan } = await import("./bimz-deep-scanner");
      const deep = await bimzDeepScan(preset.videoUrl);
      providers.push({ provider: "restapi-bimz/alight", ok: deep.ok, message: deep.message });
      if (isDirectCdnUrl(deep.meta.playableUrl)) {
        const expiresAt = new Date(Date.now() + 90 * 60_000);
        await db
          .update(presets)
          .set({
            playableUrl: deep.meta.playableUrl,
            playableSource: "bimz-deep-scan",
            playableExpiresAt: expiresAt,
            thumbnailUrl: deep.meta.cover ?? preset.thumbnailUrl,
            stats: deep.meta.stats ?? preset.stats,
            updatedAt: new Date(),
          })
          .where(eq(presets.id, presetId));
        return { url: deep.meta.playableUrl, source: "bimz-deep-scan", refreshed: true, providers };
      }
    } catch (error) {
      providers.push({
        provider: "restapi-bimz/alight",
        ok: false,
        message: error instanceof Error ? error.message.slice(0, 140) : "deep scan gagal",
      });
    }
  }

  // 2) tikwm / oEmbed metadata fallback.
  try {
    const meta = await fetchVideoMetadata(preset.videoUrl);
    for (const entry of meta.providers) {
      providers.push({ provider: entry.provider, ok: entry.ok, message: entry.message });
    }
    if (isDirectCdnUrl(meta.video?.playableUrl)) {
      const expiresAt = meta.video?.playableExpiresAt ?? new Date(Date.now() + 3 * 3600_000);
      await db
        .update(presets)
        .set({
          playableUrl: meta.video!.playableUrl!,
          playableSource: "tikwm",
          playableExpiresAt: expiresAt,
          thumbnailUrl: meta.video!.thumbnailUrl ?? preset.thumbnailUrl,
          updatedAt: new Date(),
        })
        .where(eq(presets.id, presetId));
      return { url: meta.video!.playableUrl!, source: "tikwm", refreshed: true, providers };
    }
  } catch (error) {
    providers.push({
      provider: "tiktok-metadata",
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 140) : "metadata gagal",
    });
  }

  // 3) Last resort: a usable stored CDN url even if the TTL lapsed.
  if (storedUsable) {
    return { url: stored!, source: "stale-cache", refreshed: false, providers };
  }

  // Clear a poisoned value (e.g. another site's proxy url) so we retry cleanly.
  if (stored && !storedUsable) {
    await db
      .update(presets)
      .set({ playableUrl: null, playableSource: null, playableExpiresAt: null })
      .where(eq(presets.id, presetId));
  }

  return {
    url: null,
    source: "unavailable",
    refreshed: true,
    providers,
    error: "Tidak ada URL CDN langsung dari provider manapun",
  };
}

export async function resolvePlayableUrl(presetId: string): Promise<ResolvedMedia> {
  const existing = inflight.get(presetId);
  if (existing) return existing;

  const task = resolveFresh(presetId).finally(() => {
    setTimeout(() => inflight.delete(presetId), 1500);
  });
  inflight.set(presetId, task);
  return task;
}

/** Streams an upstream media url with Range passthrough (proxy fallback). */
export async function streamMedia(rawUrl: string, rangeHeader: string | null): Promise<Response> {
  const allowed = isAllowedMediaHost(rawUrl);
  if (!allowed.ok) return Response.json({ ok: false, error: allowed.reason }, { status: 403 });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch(rawUrl, {
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "user-agent": MEDIA_UA,
        referer: "https://www.tiktok.com/",
        accept: "*/*",
        ...(rangeHeader ? { range: rangeHeader } : {}),
      },
    });

    if (!upstream.ok && upstream.status !== 206) {
      return Response.json(
        { ok: false, error: `Upstream media HTTP ${upstream.status}` },
        { status: upstream.status === 403 || upstream.status === 404 ? 404 : 502 },
      );
    }

    const headers = new Headers();
    for (const key of ["content-type", "content-length", "content-range"]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "public, max-age=3600");
    headers.set("cross-origin-resource-policy", "cross-origin");

    return new Response(upstream.body as ReadableStream<Uint8Array>, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message.slice(0, 160) : "stream gagal" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
