import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { premiumActivations, reviews, whatsappDeliveryLogs } from "@/db/schema";
import { sanitizeText } from "../http";

/* =========================================================================
 * Premium Alight — Alight Motion premium activation via RestAPI Bimz /api/am
 * -----------------------------------------------------------------------
 * Real upstream contract (discovered from the live endpoint):
 *   GET /api/am?apikey=<key>&action=send&email=<am account email>
 *       → sends a Firebase sign-in link from noreply@alight-creative.firebaseapp.com
 *   GET /api/am?apikey=<key>&action=verif&email=<email>&url=<sign-in link>
 *       → verifies the link and returns an idToken
 *   GET /api/am?apikey=<key>&action=apply&idToken=<token>
 *       → applies the subscription (am.full.sub.annual.19q4 — 1 year)
 *   GET /api/am?apikey=<key>&action=status
 *       → plan/session/quota information
 *
 * The feature is gated: a user must have 3 delivered 5-star reviews.
 * =======================================================================*/

const AM_URL = (process.env.BIMZ_AM_URL ?? "https://apirestapibimz2new.vercel.app/api/am").trim();
const AM_KEY = (process.env.BIMZ_API_KEY ?? "").trim();
export const REQUIRED_REVIEWS = Math.max(1, Number(process.env.PREMIUM_REQUIRED_REVIEWS ?? 3) || 3);

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

export type AmResult = {
  ok: boolean;
  status: number;
  message: string;
  data: UnknownRecord | null;
  rawError?: string;
  /** True when the HTTP call timed out but the action likely still succeeded. */
  timedOut?: boolean;
};

async function callAm(params: Record<string, string>): Promise<AmResult> {
  if (!AM_KEY) {
    return { ok: false, status: 0, message: "BIMZ_API_KEY belum diset di server", data: null };
  }
  const query = new URLSearchParams({ apikey: AM_KEY, ...params });
  try {
    const res = await fetch(`${AM_URL}?${query.toString()}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(110_000),
    });
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, message: "Respons /api/am bukan JSON", data: null, rawError: text.slice(0, 200) };
    }
    const record = isRecord(payload) ? payload : {};
    if (record.success === false || res.status >= 400) {
      const err = isRecord(record.error) ? record.error : {};
      return {
        ok: false,
        status: res.status,
        message: String(err.message ?? record.message ?? `HTTP ${res.status}`).slice(0, 240),
        data: null,
      };
    }
    return {
      ok: true,
      status: res.status,
      message: String(record.message ?? "OK").slice(0, 240),
      data: isRecord(record.data) ? record.data : record,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // A timeout/abort does NOT mean the email failed — Firebase often sends it
    // while the HTTP call is still open. Report that honestly.
    const aborted = /abort|timeout|terminated|socket/i.test(raw);
    return {
      ok: false,
      status: 0,
      timedOut: aborted,
      message: aborted
        ? "Permintaan ke /api/am melebihi batas waktu. Email magic link kemungkinan tetap terkirim — cek inbox/spam, lalu lanjut ke Langkah 2."
        : raw.slice(0, 200),
      data: null,
    };
  }
}

/* --------------------------------------------------------- review gating */

export type UnlockState = {
  unlocked: boolean;
  delivered: number;
  required: number;
  pending: number;
  remaining: number;
  note: string;
};

/**
 * A review only counts when it is 5-star AND its WhatsApp notification was
 * actually delivered to the developer (status = "sent"). That is the mission.
 */
export async function getUnlockState(userId: string, username: string): Promise<UnlockState> {
  const rows = await db
    .select({
      rating: reviews.rating,
      notify: reviews.notifyStatus,
      delivery: whatsappDeliveryLogs.status,
    })
    .from(reviews)
    .leftJoin(whatsappDeliveryLogs, eq(whatsappDeliveryLogs.reviewId, reviews.id))
    .where(sql`(${reviews.userId} = ${userId} or ${reviews.username} = ${username}) and ${reviews.rating} = 5`)
    .orderBy(desc(reviews.createdAt))
    .limit(50);

  const delivered = rows.filter((row) => row.delivery === "sent" || row.notify === "sent").length;
  const pending = rows.length - delivered;
  const remaining = Math.max(0, REQUIRED_REVIEWS - delivered);

  return {
    unlocked: delivered >= REQUIRED_REVIEWS,
    delivered,
    required: REQUIRED_REVIEWS,
    pending,
    remaining,
    note:
      delivered >= REQUIRED_REVIEWS
        ? "Misi selesai — Premium Alight terbuka untuk akun ini."
        : pending > 0
          ? `${pending} ulasan bintang 5 menunggu dikirim bot ke developer. Fitur terbuka otomatis setelah terkirim.`
          : `Kirim ${remaining} ulasan bintang 5 lagi untuk membuka fitur ini.`,
  };
}

/* ------------------------------------------------------------- activation */

export type ActivationState = {
  stage: string;
  email: string | null;
  plan: string | null;
  product: string | null;
  lastMessage: string | null;
  lastError: string | null;
  sentAt: string | null;
  verifiedAt: string | null;
  appliedAt: string | null;
  attempts: number;
};

export async function getActivation(userId: string): Promise<ActivationState> {
  const rows = await db.select().from(premiumActivations).where(eq(premiumActivations.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    return {
      stage: "idle",
      email: null,
      plan: null,
      product: null,
      lastMessage: null,
      lastError: null,
      sentAt: null,
      verifiedAt: null,
      appliedAt: null,
      attempts: 0,
    };
  }
  return {
    stage: row.stage,
    email: row.email,
    plan: row.plan,
    product: row.product,
    lastMessage: row.lastMessage,
    lastError: row.lastError,
    sentAt: row.sentAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    attempts: row.attempts,
  };
}

/** Depth-first hunt for an idToken anywhere in the upstream response. */
function findIdToken(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    // Firebase ID tokens are long JWTs.
    return value.length > 100 && value.split(".").length === 3 ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findIdToken(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const key of ["idToken", "id_token", "token", "access_token"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.length > 40) return candidate;
    }
    for (const item of Object.values(value)) {
      const found = findIdToken(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

async function upsertActivation(userId: string, patch: Partial<typeof premiumActivations.$inferInsert>) {
  await db
    .insert(premiumActivations)
    .values({ userId, ...patch })
    .onConflictDoUpdate({
      target: premiumActivations.userId,
      set: { ...patch, updatedAt: new Date() },
    });
}

/** Step 1 — send the Alight Motion sign-in email. */
export async function amSend(userId: string, email: string): Promise<AmResult> {
  const clean = sanitizeText(email, 120).toLowerCase();
  const result = await callAm({ action: "send", email: clean });
  // A timeout is not a failure: the magic link is usually already on its way.
  const likelySent = result.ok || result.timedOut === true;
  await upsertActivation(userId, {
    email: clean,
    stage: likelySent ? "sent" : "failed",
    lastMessage: likelySent ? result.message : null,
    lastError: likelySent ? null : result.message,
    sentAt: likelySent ? new Date() : undefined,
    attempts: sql`coalesce(${premiumActivations.attempts}, 0) + 1` as unknown as number,
  });
  return { ...result, ok: likelySent };
}

/** Step 2 — verify the sign-in link the user received by email. */
export async function amVerify(userId: string, email: string, url: string): Promise<AmResult & { idToken?: string }> {
  const clean = sanitizeText(email, 120).toLowerCase();
  const result = await callAm({ action: "verif", email: clean, url: url.trim() });
  const idToken = findIdToken(result.data);

  await upsertActivation(userId, {
    email: clean,
    stage: result.ok ? "verified" : "failed",
    // only a short, non-reversible reference is stored — never the raw token
    idTokenRef: idToken ? `${idToken.slice(0, 6)}…${idToken.slice(-4)}` : null,
    lastMessage: result.ok ? result.message : null,
    lastError: result.ok ? null : result.message,
    verifiedAt: result.ok ? new Date() : undefined,
  });
  return { ...result, idToken };
}

/** Step 3 — apply the premium subscription with the verified idToken. */
export async function amApply(userId: string, idToken: string): Promise<AmResult> {
  const result = await callAm({ action: "apply", idToken: idToken.trim() });
  const plan = result.data && isRecord(result.data.plan) ? result.data.plan : null;
  await upsertActivation(userId, {
    stage: result.ok ? "applied" : "failed",
    plan: plan && typeof plan.plan === "string" ? plan.plan : "premium-1-year",
    product: plan && typeof plan.product === "string" ? plan.product : "Alight Motion Premium 1 Tahun",
    lastMessage: result.ok ? result.message : null,
    lastError: result.ok ? null : result.message,
    appliedAt: result.ok ? new Date() : undefined,
  });
  return result;
}

/** Live upstream status (plan, quota, limits). */
export async function amStatus(): Promise<AmResult> {
  return callAm({ action: "status" });
}

export function amConfigured(): boolean {
  return Boolean(AM_KEY);
}
