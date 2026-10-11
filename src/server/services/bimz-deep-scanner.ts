import { config } from "../config";
import { sanitizeText } from "../http";
import type { ProviderPresetLink } from "./bimz-preset-provider";

/* =========================================================================
 * Bimz Deep Preset Scanner — the REAL per-video scanner.
 *
 * GET /api/alight/preset?apikey=<key>&url=<tiktok url>
 *
 * Verified live contract:
 *   data.tiktok   { id, title, author{unique_id,nickname,avatar}, cover,
 *                   video (DIRECT CDN URL), stats{plays,likes,comments,shares} }
 *   data.summary  { packages, xml_files, xml_ready, note }
 *   data.xml[]    real .xml files — downloaded & parsed upstream:
 *                 { source_link, direct_url, download_url, host, filename,
 *                   size_bytes, size_human, is_alight_xml, status,
 *                   project{ title, resolution, fps, duration_sec,
 *                            layers{total,text,shapes,media,groups},
 *                            effects, keyframes, fonts, app_version } }
 *   data.packages[] Alight Motion share projects (the "5MB" payload)
 *
 * Because the upstream actually downloads and parses each file, a hit here is
 * hard evidence — not a keyword guess.
 * =======================================================================*/

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

const str = (v: unknown, max = 600): string | null => {
  if (typeof v !== "string") return null;
  const cleaned = sanitizeText(v, max);
  return cleaned.length ? cleaned : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

export type ProjectInfo = {
  title: string | null;
  resolution: string | null;
  fps: number | null;
  durationSec: number | null;
  layers: number | null;
  effects: number | null;
  keyframes: number | null;
  appVersion: string | null;
};

export type DeepScanResult = {
  ok: boolean;
  status: "OK" | "NO_API_KEY" | "NOT_FOUND" | "HTTP_ERROR" | "EMPTY" | "RATE_LIMITED";
  /** Which key in the pool answered ("primary" / "backup-1" ...). */
  keyUsed?: string;
  /** Set when the upstream asked us to slow down; the preset must be retried. */
  retryAfterMs?: number;
  httpStatus?: number;
  message: string;
  /** Hard evidence links, already verified by the upstream parser. */
  links: ProviderPresetLink[];
  meta: {
    tiktokId: string | null;
    title: string | null;
    creator: string | null;
    creatorName: string | null;
    creatorAvatar: string | null;
    cover: string | null;
    /** Direct TikTok CDN url — immediately playable. */
    playableUrl: string | null;
    stats: { plays: number | null; likes: number | null; comments: number | null; shares: number | null } | null;
  };
  summary: { packages: number; xmlFiles: number; xmlReady: number; note: string | null };
  project: ProjectInfo | null;
};

function absoluteDownload(raw: string | null): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = config.bimz.baseUrl.replace(/\/api\/alight\/preset.*$/i, "");
  return `${base}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function mapProject(value: unknown): ProjectInfo | null {
  if (!isRecord(value)) return null;
  const layers = isRecord(value.layers) ? num(value.layers.total) : null;
  return {
    title: str(value.title, 160),
    resolution: str(value.resolution, 40),
    fps: num(value.fps),
    durationSec: num(value.duration_sec),
    layers,
    effects: num(value.effects),
    keyframes: num(value.keyframes),
    appVersion: str(value.app_version, 60),
  };
}

/**
 * Scores a scanner hit. Everything here is evidence the upstream proved by
 * actually downloading the file, so confidence is allowed to be high.
 */
function mapFile(entry: UnknownRecord, kind: "xml" | "five_mb"): ProviderPresetLink | null {
  const source = str(entry.source_link ?? entry.shareUrl ?? entry.sourceLink, 900);
  const direct = str(entry.direct_url, 900);
  const download = absoluteDownload(str(entry.download_url, 900));
  const url = source ?? direct ?? download;
  if (!url) return null;

  const isAlightXml = entry.is_alight_xml === true;
  const isXml = entry.is_xml === true;
  const ready = str(entry.status, 30) === "ready";
  const size = num(entry.size_bytes);

  let confidence = 50;
  if (isAlightXml) confidence = 97; // file downloaded AND parsed as an Alight project
  else if (isXml) confidence = 88;
  else if (kind === "five_mb") confidence = 85;
  if (ready) confidence = Math.min(100, confidence + 3);
  if (!size) confidence -= 5;

  return {
    url,
    kind,
    sourceType: "bimz_deep_scan",
    hostLabel: str(entry.host, 40) ?? "unknown",
    confidence: Math.max(0, Math.min(100, confidence)),
    // Upstream already fetched and parsed the file — this is verified evidence.
    verified: isAlightXml || isXml || (kind === "five_mb" && ready),
    detail: {
      filename: str(entry.filename, 160),
      sizeHuman: str(entry.size_human, 30),
      sizeBytes: size,
      contentType: str(entry.content_type, 80),
      isAlightXml,
      status: str(entry.status, 30),
      directUrl: direct,
      downloadUrl: download,
      project: mapProject(entry.project),
      title: str(entry.title, 160),
    },
  };
}

/* ------------------------------------------------------------ key rotation */

type KeyState = { key: string; cooldownUntil: number; label: string };

const globalForKeys = globalThis as typeof globalThis & { __bimzKeys?: KeyState[] };

function keyPool(): KeyState[] {
  if (!globalForKeys.__bimzKeys) {
    globalForKeys.__bimzKeys = config.bimz.apiKeys.map((key, index) => ({
      key,
      cooldownUntil: 0,
      label: index === 0 ? "primary" : `backup-${index}`,
    }));
  }
  return globalForKeys.__bimzKeys;
}

/** Keys that are not cooling down, primary first. */
function availableKeys(): KeyState[] {
  const now = Date.now();
  const pool = keyPool();
  const ready = pool.filter((entry) => entry.cooldownUntil <= now);
  // If every key is cooling down, use the one that recovers soonest.
  return ready.length > 0 ? ready : [[...pool].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]!];
}

export function keyPoolStatus(): { label: string; cooling: boolean; cooldownSec: number }[] {
  const now = Date.now();
  return keyPool().map((entry) => ({
    label: entry.label,
    cooling: entry.cooldownUntil > now,
    cooldownSec: Math.max(0, Math.round((entry.cooldownUntil - now) / 1000)),
  }));
}

function isQuotaMessage(message: string, status: number, code: string): boolean {
  return (
    status === 429 ||
    code === "RATE_LIMIT" ||
    /limit exceeded|rate limit|too many|kuota|quota/i.test(message)
  );
}

type RawCall = {
  ok: boolean;
  status: number;
  quota: boolean;
  message: string;
  root: UnknownRecord;
  keyLabel: string;
};

async function callScanner(tiktokUrl: string, apiKey: string, label: string): Promise<RawCall> {
  const url = `${config.bimz.baseUrl}?apikey=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(tiktokUrl)}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(config.bimz.deepTimeoutMs),
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, quota: false, message: `Respons non-JSON (HTTP ${res.status})`, root: {}, keyLabel: label };
    }
    const root = isRecord(payload) ? payload : {};
    if (root.success === false || res.status >= 400) {
      const err = isRecord(root.error) ? root.error : {};
      const message = String(err.message ?? `HTTP ${res.status}`).slice(0, 220);
      return {
        ok: false,
        status: res.status,
        quota: isQuotaMessage(message, res.status, String(err.code ?? "")),
        message,
        root,
        keyLabel: label,
      };
    }
    return { ok: true, status: res.status, quota: false, message: "OK", root, keyLabel: label };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      quota: false,
      message: error instanceof Error ? error.message.slice(0, 200) : "deep scan gagal",
      root: {},
      keyLabel: label,
    };
  }
}

/**
 * Runs the real deep scan for one TikTok URL, rotating through every
 * configured API key before ever reporting a quota failure.
 */
export async function bimzDeepScan(tiktokUrl: string): Promise<DeepScanResult> {
  const empty: DeepScanResult["meta"] = {
    tiktokId: null,
    title: null,
    creator: null,
    creatorName: null,
    creatorAvatar: null,
    cover: null,
    playableUrl: null,
    stats: null,
  };
  const emptySummary = { packages: 0, xmlFiles: 0, xmlReady: 0, note: null };

  if (!config.bimz.enabled || config.bimz.apiKeys.length === 0) {
    return {
      ok: false,
      status: "NO_API_KEY",
      message: "BIMZ_API_KEY belum diset — deep scanner tidak dapat dipanggil.",
      links: [],
      meta: empty,
      summary: emptySummary,
      project: null,
    };
  }

  let lastCall: RawCall | null = null;

  for (const entry of availableKeys()) {
    const call = await callScanner(tiktokUrl, entry.key, entry.label);
    lastCall = call;

    if (call.quota) {
      // Park this key and immediately retry with the next one.
      entry.cooldownUntil = Date.now() + 10 * 60_000;
      continue;
    }
    if (!call.ok) break;

    entry.cooldownUntil = 0;

    const data = isRecord(call.root.data) ? call.root.data : {};
    const tiktok = isRecord(data.tiktok) ? data.tiktok : {};
    const author = isRecord(tiktok.author) ? tiktok.author : {};
    const stats = isRecord(tiktok.stats) ? tiktok.stats : null;
    const summaryRaw = isRecord(data.summary) ? data.summary : {};

    const links: ProviderPresetLink[] = [];
    const seen = new Set<string>();
    const push = (link: ProviderPresetLink | null) => {
      if (!link || seen.has(link.url)) return;
      seen.add(link.url);
      links.push(link);
    };

    for (const item of Array.isArray(data.xml) ? data.xml : []) {
      if (isRecord(item)) push(mapFile(item, "xml"));
    }
    for (const item of Array.isArray(data.packages) ? data.packages : []) {
      if (isRecord(item)) push(mapFile(item, "five_mb"));
    }
    for (const item of Array.isArray(data.files) ? data.files : []) {
      if (!isRecord(item)) continue;
      const kind = /package|share|project/i.test(String(item.kind ?? item.type ?? "")) ? "five_mb" : "xml";
      push(mapFile(item, kind));
    }

    const firstProject = links.find((link) => link.detail?.project)?.detail?.project as ProjectInfo | undefined;
    const xmlCount = links.filter((link) => link.kind === "xml").length;
    const packCount = links.filter((link) => link.kind === "five_mb").length;

    return {
      ok: true,
      status: links.length > 0 ? "OK" : "EMPTY",
      httpStatus: call.status,
      keyUsed: call.keyLabel,
      message:
        links.length > 0
          ? `Deep scan [${call.keyLabel}] menemukan ${xmlCount} XML + ${packCount} paket`
          : `Deep scan [${call.keyLabel}] selesai — video ini tidak memuat file preset`,
      links,
      meta: {
        tiktokId: str(tiktok.id, 40),
        title: str(tiktok.title, 4000),
        creator: str(author.unique_id, 60)?.toLowerCase() ?? null,
        creatorName: str(author.nickname, 120),
        creatorAvatar: str(author.avatar, 900),
        cover: str(tiktok.cover, 900),
        playableUrl: str(tiktok.video, 900),
        stats: stats
          ? { plays: num(stats.plays), likes: num(stats.likes), comments: num(stats.comments), shares: num(stats.shares) }
          : null,
      },
      summary: {
        packages: num(summaryRaw.packages) ?? 0,
        xmlFiles: num(summaryRaw.xml_files) ?? 0,
        xmlReady: num(summaryRaw.xml_ready) ?? 0,
        note: str(summaryRaw.note, 300),
      },
      project: firstProject ?? null,
    };
  }

  // Every key was exhausted (or the upstream errored).
  if (lastCall?.quota) {
    return {
      ok: false,
      status: "RATE_LIMITED",
      httpStatus: lastCall.status,
      retryAfterMs: 10 * 60_000,
      message: `Semua API key RestAPI Bimz sedang kena kuota — video belum diperiksa, dijadwalkan ulang. (${lastCall.message})`,
      links: [],
      meta: empty,
      summary: emptySummary,
      project: null,
    };
  }

  return {
    ok: false,
    status: lastCall?.status === 404 ? "NOT_FOUND" : "HTTP_ERROR",
    httpStatus: lastCall?.status,
    message: lastCall?.message ?? "Deep scanner tidak dapat dihubungi",
    links: [],
    meta: empty,
    summary: emptySummary,
    project: null,
  };
}

export function deepScannerConfigured(): boolean {
  return config.bimz.enabled;
}
