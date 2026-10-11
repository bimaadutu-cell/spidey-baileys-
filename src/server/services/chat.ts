import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { botRuntime, globalChatMessages, type ChatMessage } from "@/db/schema";
import { config } from "../config";
import { sanitizeText } from "../http";

const HEARTBEAT_FRESH_MS = 120_000;

/* ------------------------------------------------------------- realtime bus */

const globalForBus = globalThis as typeof globalThis & { __presetSpaceBus?: EventEmitter };
export const bus = globalForBus.__presetSpaceBus ?? new EventEmitter();
bus.setMaxListeners(0);
globalForBus.__presetSpaceBus = bus;

export type ChatDto = {
  id: string;
  source: string;
  authorName: string;
  authorJid: string | null;
  avatarKey: string | null;
  body: string;
  isDeveloper: boolean;
  createdAt: string;
};

function toDto(row: ChatMessage): ChatDto {
  return {
    id: row.id,
    source: row.source,
    authorName: row.authorName,
    authorJid: row.authorJid,
    avatarKey: row.avatarKey,
    body: row.body,
    isDeveloper: row.isDeveloper,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMessages(options: { since?: string; limit?: number } = {}): Promise<ChatDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  if (options.since) {
    const since = new Date(options.since);
    if (!Number.isNaN(since.getTime())) {
      const rows = await db
        .select()
        .from(globalChatMessages)
        .where(and(gt(globalChatMessages.createdAt, since)))
        .orderBy(asc(globalChatMessages.createdAt))
        .limit(limit);
      return rows.map(toDto);
    }
  }
  const rows = await db
    .select()
    .from(globalChatMessages)
    .orderBy(desc(globalChatMessages.createdAt))
    .limit(limit);
  return rows.reverse().map(toDto);
}

/** Effective bot configuration: panel (DB) values win over environment. */
export async function getBotConfig(): Promise<{
  botNumber: string;
  targetNumber: string;
  displayName: string;
  globalChatEnabled: boolean;
  reviewNotifyEnabled: boolean;
  platform: string;
  browser: string;
  integration: string;
  source: "panel" | "env";
}> {
  const rows = await db.select().from(botRuntime).where(eq(botRuntime.id, "whatsapp")).limit(1);
  const row = rows[0];
  const panelBot = row?.configBotNumber?.replace(/\D/g, "") ?? "";
  const panelTarget = row?.configTargetNumber?.replace(/\D/g, "") ?? "";
  const botNumber = panelBot || config.whatsapp.developerNumber;
  return {
    botNumber,
    targetNumber: panelTarget || botNumber,
    displayName: row?.configDisplayName || config.whatsapp.globalChatDisplayName,
    globalChatEnabled: row ? row.configGlobalChatEnabled : config.whatsapp.globalChatEnabled,
    reviewNotifyEnabled: row ? row.configReviewNotifyEnabled : true,
    platform: row?.configPlatform || "Ubuntu 22.04",
    browser: row?.configBrowser || "Chrome",
    integration: row?.configIntegration || "SPACEPRS",
    source: panelBot ? "panel" : "env",
  };
}

function developerIdentityFor(
  jid: string | null,
  cfg: { botNumber: string; displayName: string },
): { name: string; isDeveloper: boolean } {
  const normalizedBot = cfg.botNumber.replace(/\D/g, "");
  const candidate = (jid ?? "").replace(/[^0-9]/g, "");
  const allowed = Boolean(normalizedBot) && candidate === normalizedBot;
  return {
    name: allowed ? cfg.displayName : sanitizeText(jid ?? "unknown", 60),
    isDeveloper: allowed,
  };
}

/**
 * Ingests a WhatsApp message coming from the bot worker.
 * Only the configured developer JID is ever published as a developer message;
 * other participants are ignored (never forwarded, never spoofed).
 */
export async function ingestWhatsAppMessage(input: {
  clientKey: string;
  jid: string | null;
  body: string;
  pushName?: string | null;
  fromMe?: boolean;
}): Promise<{ inserted: boolean; reason?: string; message?: ChatDto }> {
  const botConfig = await getBotConfig();
  if (!botConfig.globalChatEnabled) {
    return { inserted: false, reason: "Global Chat dimatikan dari panel admin" };
  }
  const identity = developerIdentityFor(input.jid, botConfig);
  if (!identity.isDeveloper) {
    return { inserted: false, reason: "JID bukan developer — pesan tidak diteruskan" };
  }
  const body = sanitizeText(input.body, 1200);
  if (!body) return { inserted: false, reason: "Pesan kosong" };

  const rows = await db
    .insert(globalChatMessages)
    .values({
      clientKey: input.clientKey.slice(0, 190),
      source: "whatsapp",
      authorName: identity.name,
      authorJid: input.jid,
      avatarKey: "developer",
      body,
      isDeveloper: true,
    })
    .onConflictDoNothing({ target: globalChatMessages.clientKey })
    .returning();

  const row = rows[0];
  if (!row) return { inserted: false, reason: "Duplikat (ID WhatsApp sudah ada)" };
  const message = toDto(row);
  bus.emit("chat", message);
  return { inserted: true, message };
}

export async function postWebsiteMessage(input: {
  userId: string;
  username: string;
  avatarKey: string | null;
  body: string;
}): Promise<ChatDto> {
  const body = sanitizeText(input.body, 600);
  const rows = await db
    .insert(globalChatMessages)
    .values({
      clientKey: `web:${randomUUID()}`,
      source: "website",
      authorName: sanitizeText(input.username, 60),
      authorUserId: input.userId,
      avatarKey: input.avatarKey,
      body,
      isDeveloper: false,
    })
    .returning();
  const message = toDto(rows[0]!);
  bus.emit("chat", message);
  return message;
}

/* ------------------------------------------------------------ bot runtime */

export type BotStatus = {
  configured: boolean;
  status: string;
  phone: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  live: boolean;
  integrationName: string;
};

export async function getBotStatus(): Promise<BotStatus> {
  const rows = await db.select().from(botRuntime).where(eq(botRuntime.id, "whatsapp")).limit(1);
  const row = rows[0];
  if (!row) {
    return {
      configured: Boolean(config.internalToken),
      status: "offline",
      phone: null,
      pairingCode: null,
      pairingExpiresAt: null,
      connectedAt: null,
      lastHeartbeatAt: null,
      live: false,
      integrationName: "SPACEPRS",
    };
  }
  const live =
    Boolean(row.lastHeartbeatAt && Date.now() - row.lastHeartbeatAt.getTime() < HEARTBEAT_FRESH_MS) &&
    row.status === "connected";
  return {
    configured: Boolean(config.internalToken),
    status: row.status,
    phone: row.phone,
    pairingCode: live || row.status === "waiting_pairing" ? row.pairingCode : null,
    pairingExpiresAt: row.pairingExpiresAt ? row.pairingExpiresAt.toISOString() : null,
    connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    live,
    integrationName: "SPACEPRS",
  };
}

export async function upsertBotRuntime(update: {
  status?: string;
  phone?: string | null;
  pairingCode?: string | null;
  pairingExpiresAt?: Date | null;
  meta?: Record<string, unknown>;
  heartbeat?: boolean;
}): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (update.status !== undefined) patch.status = update.status;
  if (update.phone !== undefined) patch.phone = update.phone;
  if (update.pairingCode !== undefined) patch.pairingCode = update.pairingCode;
  if (update.pairingExpiresAt !== undefined) patch.pairingExpiresAt = update.pairingExpiresAt;
  if (update.meta !== undefined) patch.meta = update.meta;
  if (update.heartbeat) patch.lastHeartbeatAt = new Date();
  if (update.status === "connected") patch.connectedAt = new Date();

  await db
    .insert(botRuntime)
    .values({
      id: "whatsapp",
      status: (update.status as string) ?? "connecting",
      phone: update.phone ?? null,
      pairingCode: update.pairingCode ?? null,
      pairingExpiresAt: update.pairingExpiresAt ?? null,
      meta: update.meta ?? {},
      lastHeartbeatAt: update.heartbeat ? new Date() : null,
      connectedAt: update.status === "connected" ? new Date() : null,
    })
    .onConflictDoUpdate({ target: botRuntime.id, set: patch });
}

/** Persists bot configuration entered from the /admin panel. */
export async function saveBotConfig(input: {
  botNumber?: string;
  targetNumber?: string;
  displayName?: string;
  globalChatEnabled?: boolean;
  reviewNotifyEnabled?: boolean;
  platform?: string;
  browser?: string;
  integration?: string;
}): Promise<void> {
  const patch: Record<string, unknown> = { configUpdatedAt: new Date(), updatedAt: new Date() };
  if (input.botNumber !== undefined) patch.configBotNumber = input.botNumber.replace(/\D/g, "");
  if (input.targetNumber !== undefined) patch.configTargetNumber = input.targetNumber.replace(/\D/g, "");
  if (input.displayName !== undefined) patch.configDisplayName = sanitizeText(input.displayName, 60);
  if (input.globalChatEnabled !== undefined) patch.configGlobalChatEnabled = input.globalChatEnabled;
  if (input.reviewNotifyEnabled !== undefined) patch.configReviewNotifyEnabled = input.reviewNotifyEnabled;
  if (input.platform !== undefined) patch.configPlatform = sanitizeText(input.platform, 40);
  if (input.browser !== undefined) patch.configBrowser = sanitizeText(input.browser, 40);
  if (input.integration !== undefined) patch.configIntegration = sanitizeText(input.integration, 40);

  const existing = await db.select({ id: botRuntime.id }).from(botRuntime).where(eq(botRuntime.id, "whatsapp")).limit(1);
  if (existing[0]) {
    await db.update(botRuntime).set(patch).where(eq(botRuntime.id, "whatsapp"));
  } else {
    await db.insert(botRuntime).values({ id: "whatsapp", status: "disconnected", ...patch });
  }
}

/* --------------------------------------------------------- database health */

export async function databaseHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : "unknown" };
  }
}
