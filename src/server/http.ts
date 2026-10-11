import { NextRequest } from "next/server";

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: message, ...extra }, { status });
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

/* ---------------------------------------------------------- rate limiting */

type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Bucket>();

/** Simple token bucket. Enough for single-instance deployments; DB backed limits can be added later. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { tokens: limit - 1, updatedAt: now });
    return true;
  }
  const refill = ((now - bucket.updatedAt) / windowMs) * limit;
  bucket.tokens = Math.min(limit, bucket.tokens + refill);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function tooMany(): Response {
  return json({ ok: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." }, { status: 429 });
}

/* ------------------------------------------------------------------- ssrf */

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i,
  /^metadata/i,
];

/**
 * Validates a URL found in external content before the server touches it.
 * Blocks private networks, cloud metadata and non http(s) schemes (SSRF guard).
 */
export function isSafePublicUrl(raw: string): { ok: boolean; url?: URL; reason?: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "URL tidak valid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Skema tidak diizinkan" };
  }
  const host = url.hostname;
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, reason: "Host internal / privat diblokir" };
  }
  if (url.port && !["", "80", "443"].includes(url.port)) {
    return { ok: false, reason: "Port tidak standar diblokir" };
  }
  return { ok: true, url };
}

/** Removes control chars + angle brackets from text scraped from TikTok. */
export function sanitizeText(input: string, maxLength = 2000): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[<>]/g, "")
    .slice(0, maxLength)
    .trim();
}

export async function readJson<T>(req: NextRequest, maxBytes = 20_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
