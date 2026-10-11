import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/server/auth";
import { fail, json, readJson } from "@/server/http";
import { getBotConfig, getBotStatus } from "@/server/services/chat";
import {
  resetSession,
  startPairing,
  stopWorker,
  triggerDeliveryPump,
  workerSnapshot,
} from "@/server/services/whatsapp-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Live worker state for the admin panel (polled). */
export async function GET() {
  const user = await getCurrentUser();
  if (!(await isAdmin(user))) return fail("Akses admin diperlukan", 403);
  const [status, config] = await Promise.all([getBotStatus(), getBotConfig()]);
  return json({ ok: true, worker: workerSnapshot(), status, config });
}

const schema = z.object({
  action: z.enum(["pair", "stop", "reset", "pump"]),
  phone: z.string().max(20).regex(/^\d*$/).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!(await isAdmin(user))) return fail("Akses admin diperlukan", 403);

  const parsed = schema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail("Aksi tidak valid", 422);

  if (parsed.data.action === "pair") {
    const result = await startPairing({ phone: parsed.data.phone || undefined });
    return json({ ...result, worker: workerSnapshot() }, { status: result.ok ? 200 : 503 });
  }
  if (parsed.data.action === "stop") {
    const result = await stopWorker();
    return json({ ...result, worker: workerSnapshot() });
  }
  if (parsed.data.action === "reset") {
    const result = await resetSession();
    return json({ ...result, worker: workerSnapshot() });
  }
  const result = await triggerDeliveryPump();
  return json({ ...result, worker: workerSnapshot() });
}
