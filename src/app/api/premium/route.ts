import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { clientIp, fail, json, rateLimit, readJson, tooMany } from "@/server/http";
import {
  amApply,
  amConfigured,
  amSend,
  amStatus,
  amVerify,
  getActivation,
  getUnlockState,
  REQUIRED_REVIEWS,
} from "@/server/services/premium-alight";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET — unlock progress + activation state + live upstream status. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return json({
      ok: true,
      authenticated: false,
      unlock: { unlocked: false, delivered: 0, required: REQUIRED_REVIEWS, pending: 0, remaining: REQUIRED_REVIEWS, note: "Login dulu untuk memulai misi." },
      activation: null,
      configured: amConfigured(),
    });
  }

  const [unlock, activation, upstream] = await Promise.all([
    getUnlockState(user.id, user.username),
    getActivation(user.id),
    amStatus(),
  ]);

  return json({
    ok: true,
    authenticated: true,
    unlock,
    activation,
    configured: amConfigured(),
    upstream: {
      ok: upstream.ok,
      message: upstream.message,
      plan: upstream.data?.plan ?? null,
      quota: upstream.data?.quota ?? null,
    },
  });
}

const sendSchema = z.object({ action: z.literal("send"), email: z.string().email().max(120) });
const verifySchema = z.object({
  action: z.literal("verify"),
  email: z.string().email().max(120),
  url: z.string().min(20).max(2000),
});
const applySchema = z.object({ action: z.literal("apply"), idToken: z.string().min(20).max(4000) });
const bodySchema = z.discriminatedUnion("action", [sendSchema, verifySchema, applySchema]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan", 401);
  if (!rateLimit(`premium:${user.id}:${clientIp(req)}`, 12, 300_000)) return tooMany();
  if (!amConfigured()) return fail("BIMZ_API_KEY belum dikonfigurasi di server", 503);

  // Server-side gate: the mission must be completed before any upstream call.
  const unlock = await getUnlockState(user.id, user.username);
  if (!unlock.unlocked) {
    return json(
      { ok: false, locked: true, error: "Fitur terkunci. Selesaikan misi ulasan dulu.", unlock },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await readJson<unknown>(req, 10_000));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Data tidak valid", 422);
  const data = parsed.data;

  if (data.action === "send") {
    try {
      const result = await amSend(user.id, data.email);
      // Always 200 with JSON when the email was (or was very likely) sent — never
      // surface a raw HTTP 500 to the browser for this step.
      return json({
        ok: result.ok,
        message: result.ok
          ? "Email login Alight Motion berhasil dikirim. Cek inbox / spam, lalu lanjut ke Langkah 2."
          : result.message,
        error: result.ok ? undefined : result.message,
        activation: await getActivation(user.id),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown";
      // Soft-success: user reports the mail arrives even when our process crashes after the upstream call.
      return json({
        ok: true,
        message:
          "Permintaan kirim email sudah diproses. Jika belum masuk, cek spam atau tekan kirim sekali lagi. (" +
          msg.slice(0, 80) +
          ")",
        activation: null,
      });
    }
  }

  if (data.action === "verify") {
    const result = await amVerify(user.id, data.email, data.url);
    return json(
      {
        ok: result.ok,
        message: result.ok ? "Link terverifikasi. Lanjut ke langkah aktivasi." : result.message,
        error: result.ok ? undefined : result.message,
        // Returned once so the browser can immediately run step 3; never stored raw.
        idToken: result.idToken ?? null,
        activation: await getActivation(user.id),
      },
      { status: result.ok ? 200 : 502 },
    );
  }

  const result = await amApply(user.id, data.idToken);
  return json(
    {
      ok: result.ok,
      message: result.ok ? "Alight Motion Premium berhasil diaktifkan." : result.message,
      error: result.ok ? undefined : result.message,
      data: result.data,
      activation: await getActivation(user.id),
    },
    { status: result.ok ? 200 : 502 },
  );
}
