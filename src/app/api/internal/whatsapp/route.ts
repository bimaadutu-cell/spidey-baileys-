import { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/server/config";
import { fail, json, readJson } from "@/server/http";
import { internalTokenOk } from "@/server/auth";
import { getBotStatus, ingestWhatsAppMessage, listMessages, upsertBotRuntime } from "@/server/services/chat";
import { claimDeliveries, markDelivery } from "@/server/services/reviews";

export const dynamic = "force-dynamic";

/**
 * Authenticated bridge used by the SPACEPRS WhatsApp bot worker
 * (server/workers/whatsapp-bot.mjs). Every call requires INTERNAL_TOKEN.
 */

const heartbeatSchema = z.object({
  action: z.literal("heartbeat"),
  status: z.enum(["disconnected", "connecting", "waiting_pairing", "connected"]),
  phone: z.string().max(24).optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const pairingSchema = z.object({
  action: z.literal("pairing_code"),
  code: z.string().min(4).max(12),
  phone: z.string().max(24).optional().nullable(),
  expiresInSeconds: z.number().int().min(10).max(3600).optional(),
});

const ingestSchema = z.object({
  action: z.literal("ingest_message"),
  messageId: z.string().min(3).max(190),
  jid: z.string().max(120).nullable().optional(),
  body: z.string().min(1).max(4000),
  fromMe: z.boolean().optional(),
  pushName: z.string().max(120).nullable().optional(),
});

const claimSchema = z.object({ action: z.literal("claim_deliveries"), limit: z.number().int().min(1).max(10).optional() });

const resultSchema = z.object({
  action: z.literal("delivery_result"),
  id: z.string().uuid(),
  status: z.enum(["sent", "failed"]),
  error: z.string().max(300).optional().nullable(),
});

const bodySchema = z.discriminatedUnion("action", [
  heartbeatSchema,
  pairingSchema,
  ingestSchema,
  claimSchema,
  resultSchema,
]);

export async function GET(req: NextRequest) {
  if (!internalTokenOk(req.headers.get("authorization"))) return fail("Token internal tidak valid", 401);
  const [bot, pending, messages] = await Promise.all([
    getBotStatus(),
    claimDeliveries(0),
    listMessages({ limit: 1 }),
  ]);
  return json({
    ok: true,
    bot,
    developerTarget: config.whatsapp.developerNumber,
    globalChatEnabled: config.whatsapp.globalChatEnabled,
    globalChatSourceJid: config.whatsapp.globalChatSourceJid || null,
    pendingDeliveries: pending.length,
    lastMessageAt: messages.at(-1)?.createdAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!internalTokenOk(req.headers.get("authorization"))) return fail("Token internal tidak valid", 401);
  const parsed = bodySchema.safeParse(await readJson<unknown>(req, 60_000));
  if (!parsed.success) return fail("Payload tidak valid", 422);
  const data = parsed.data;

  switch (data.action) {
    case "heartbeat": {
      await upsertBotRuntime({
        status: data.status,
        phone: data.phone ?? undefined,
        meta: data.meta,
        heartbeat: true,
      });
      return json({ ok: true });
    }
    case "pairing_code": {
      await upsertBotRuntime({
        status: "waiting_pairing",
        pairingCode: data.code,
        phone: data.phone ?? undefined,
        pairingExpiresAt: new Date(Date.now() + (data.expiresInSeconds ?? 300) * 1000),
        heartbeat: true,
      });
      return json({ ok: true });
    }
    case "ingest_message": {
      const result = await ingestWhatsAppMessage({
        clientKey: data.messageId,
        jid: data.jid ?? null,
        body: data.body,
        pushName: data.pushName ?? null,
        fromMe: data.fromMe,
      });
      return json({ ok: true, ...result });
    }
    case "claim_deliveries": {
      const tasks = await claimDeliveries(data.limit ?? 3);
      return json({ ok: true, tasks });
    }
    case "delivery_result": {
      await markDelivery(data.id, data.status, data.error ?? null);
      return json({ ok: true });
    }
  }
}
