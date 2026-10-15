#!/usr/bin/env node
/**
 * SPACEPRS — WhatsApp worker for 预设空间 | Preset Space
 * Developer: BimzOfficial ✓
 *
 * Responsibilities (ONLY these two):
 *   1. Forward the developer's normal WhatsApp messages into the website Global Chat.
 *   2. Deliver website review notifications (PNG) to the developer's number.
 *
 * This is a LONG RUNNING process. It is not a Vercel serverless function.
 * Run it on a persistent host (VPS/Ubuntu + PM2, Railway, Fly.io, Render worker, ...):
 *
 *   INTERNAL_TOKEN=... APP_URL=https://your-app ... pm2 start server/workers/whatsapp-bot.mjs --name spaceprs
 *
 * Required environment variables:
 *   APP_URL                  base URL of the Next.js app (e.g. http://localhost:3000)
 *   INTERNAL_TOKEN           same value as the app's INTERNAL_TOKEN
 *   WHATSAPP_BOT_PHONE       the number that will be paired (E.164, no +, e.g. 6283115955196)
 *   GLOBAL_CHAT_SOURCE_JID   optional explicit developer JID, e.g. 6283115955196@s.whatsapp.net
 *   WHATSAPP_DELIVERY_TARGET defaults to 6283115955196
 *   SESSION_DIR              optional directory for the Baileys session (default ./.spaceprs-session)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";
const PHONE = (process.env.WHATSAPP_BOT_PHONE ?? "").replace(/\D/g, "");
const SESSION_DIR = process.env.SESSION_DIR ?? path.resolve(".spaceprs-session");
const DELIVERY_TARGET = (process.env.WHATSAPP_DELIVERY_TARGET ?? "6283115955196").replace(/\D/g, "");
const POLL_MS = Number(process.env.DELIVERY_POLL_MS ?? 15_000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 30_000);

if (!INTERNAL_TOKEN) {
  console.error("[SPACEPRS] INTERNAL_TOKEN is required.");
  process.exit(1);
}

const state = {
  sock: null,
  status: "connecting",
  phone: PHONE || null,
  delivered: new Set(), // idempotency keys already handled this process lifetime
  processing: false,
};

function log(level, message, extra = "") {
  const line = `[SPACEPRS][${new Date().toISOString()}][${level}] ${message}${extra ? ` ${extra}` : ""}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

async function api(pathname, options = {}) {
  const res = await fetch(`${APP_URL}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${INTERNAL_TOKEN}`,
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, error: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

async function reportStatus(status, extra = {}) {
  state.status = status;
  const { status: code, json } = await api("/api/internal/whatsapp", {
    method: "POST",
    body: JSON.stringify({ action: "heartbeat", status, phone: state.phone, meta: extra }),
  });
  if (code !== 200) log("warn", "heartbeat gagal", JSON.stringify(json));
}

async function reportPairingCode(code) {
  await api("/api/internal/whatsapp", {
    method: "POST",
    body: JSON.stringify({ action: "pairing_code", code, phone: state.phone }),
  });
}

function extractText(message) {
  if (!message) return "";
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.ephemeralMessage?.message?.conversation ||
    ""
  );
}

function developerJids() {
  const jids = new Set();
  if (process.env.GLOBAL_CHAT_SOURCE_JID) jids.add(process.env.GLOBAL_CHAT_SOURCE_JID);
  const target = DELIVERY_TARGET || PHONE;
  if (target) {
    jids.add(`${target}@s.whatsapp.net`);
    jids.add(`${target}@c.us`);
  }
  if (PHONE) jids.add(`${PHONE}@s.whatsapp.net`);
  return jids;
}

async function deliverPending() {
  if (!state.sock || state.status !== "connected" || state.processing) return;
  state.processing = true;
  try {
    const { json } = await api("/api/internal/whatsapp", {
      method: "POST",
      body: JSON.stringify({ action: "claim_deliveries", limit: 3 }),
    });
    const tasks = json?.tasks ?? [];
    for (const task of tasks) {
      if (!task?.id) continue;
      if (state.delivered.has(task.idempotencyKey)) {
        await api("/api/internal/whatsapp", {
          method: "POST",
          body: JSON.stringify({ action: "delivery_result", id: task.id, status: "sent" }),
        });
        continue;
      }

      try {
        const imageRes = await fetch(`${APP_URL}${task.imageUrl ?? `/api/reviews/${task.reviewId}/image`}`, {
          headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
        });
        if (!imageRes.ok) throw new Error(`PNG render HTTP ${imageRes.status}`);
        const buffer = Buffer.from(await imageRes.arrayBuffer());

        const jid = `${task.target.replace(/\D/g, "")}@s.whatsapp.net`;
        const sentMsg = await state.sock.sendMessage(jid, {
          image: buffer,
          caption: `预设空间 | Preset Space — NEW WEBSITE REVIEW\n${task.review.username} · ${"★".repeat(task.review.rating)}\n\n${task.review.body}`,
        });

        if (sentMsg?.key?.id) (state.sentIds ??= new Set()).add(sentMsg.key.id);
        state.delivered.add(task.idempotencyKey);
        await api("/api/internal/whatsapp", {
          method: "POST",
          body: JSON.stringify({ action: "delivery_result", id: task.id, status: "sent" }),
        });
        log("info", "ulasan terkirim", task.idempotencyKey);
      } catch (error) {
        await api("/api/internal/whatsapp", {
          method: "POST",
          body: JSON.stringify({
            action: "delivery_result",
            id: task.id,
            status: "failed",
            error: String(error?.message ?? error).slice(0, 280),
          }),
        });
        log("error", "pengiriman ulasan gagal", String(error?.message ?? error));
      }
    }
  } catch (error) {
    log("error", "poll antrean gagal", String(error?.message ?? error));
  } finally {
    state.processing = false;
  }
}

async function connect() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const [{ state: authState, saveCreds }, { version }] = await Promise.all([
    useMultiFileAuthState(SESSION_DIR),
    fetchLatestBaileysVersion(),
  ]);

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    browser: ["SPACEPRS", "Chrome", "1.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  state.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !authState.creds.registered) {
      log("warn", "QR diterima tetapi mode pairing code aktif. Set WHATSAPP_BOT_PHONE untuk pairing code.");
    }

    if (!authState.creds.registered && PHONE && connection === "connecting") {
      // Pairing code must be requested while the socket is connecting and unregistered.
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(PHONE);
          log("info", `PAIRING CODE: ${code}`);
          await reportPairingCode(code);
        } catch (error) {
          log("error", "gagal membuat pairing code", String(error?.message ?? error));
        }
      }, 2500);
    }

    if (connection === "open") {
      state.phone = sock.user?.id?.split(":")[0] ?? state.phone;
      log("info", "WhatsApp tersambung", state.phone ?? "");
      await reportStatus("connected", { user: sock.user?.id ?? null });
    } else if (connection === "connecting") {
      await reportStatus("connecting");
    } else if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reason = DisconnectReason[statusCode] ?? statusCode;
      log("warn", "koneksi tertutup", String(reason));
      await reportStatus("disconnected", { reason: String(reason) });
      if (statusCode === DisconnectReason.loggedOut) {
        log("error", "Sesi logout. Hapus folder sesi lalu pairing ulang:", SESSION_DIR);
        return;
      }
      setTimeout(() => void connect(), 5000);
    }
  });

  // Global Chat: ONLY the private chat with the developer number is forwarded.
  // Groups, other contacts, other chats on the developer's phone, history replays
  // and the bot's own outbound messages are all ignored.
  const normPhone = (value) => {
    let d = String(value ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("0")) d = `62${d.slice(1)}`;
    else if (d.startsWith("8") && d.length >= 9 && d.length <= 12) d = `62${d}`;
    return d;
  };
  const isTemplate = (t) =>
    /^🛠️\s*\*?LAPORAN/i.test(t) || /^🔔\s*\*?Private Ping/i.test(t) || /^💬\s*\*?Global Chat/i.test(t) ||
    /预设空间\s*\|\s*Preset Space/i.test(t) || /^Balas dengan:\s*#balas/i.test(t);
  const sentIds = (state.sentIds ??= new Set());

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const developers = new Set([DELIVERY_TARGET, process.env.WHATSAPP_DEVELOPER_NUMBER].map(normPhone).filter(Boolean));
    const botPhone = normPhone(state.phone ?? PHONE);
    const botIsDeveloper = developers.has(botPhone);
    for (const message of messages) {
      const body = extractText(message.message);
      if (!body) continue;
      const key = message.key ?? {};
      const jid = key.remoteJid ?? "";
      const fromMe = Boolean(key.fromMe);

      if (!(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) continue; // no groups/status/channels
      if (key.id && sentIds.has(key.id)) continue; // our own echo
      if (isTemplate(body.trim())) continue;
      const ts = Number(message.messageTimestamp?.low ?? message.messageTimestamp ?? 0);
      if (ts && Date.now() / 1000 - ts > 180) continue; // offline history replay

      const alt = [key.remoteJidAlt, key.senderPn, key.participantPn].find((j) => j && j.endsWith("@s.whatsapp.net"));
      const chat = normPhone(jid.endsWith("@lid") ? alt : jid);
      if (!chat || !developers.has(chat)) continue; // not the developer's chat
      if (fromMe && !(botIsDeveloper && chat === botPhone)) continue; // only self-chat when bot == developer
      if (!fromMe && botIsDeveloper && chat === botPhone) continue; // mirror of our own self-chat

      try {
        const { json } = await api("/api/internal/whatsapp", {
          method: "POST",
          body: JSON.stringify({
            action: "ingest_message",
            messageId: key.id ?? `${Date.now()}-${Math.random()}`,
            jid: `${chat}@s.whatsapp.net`,
            body,
            fromMe,
            pushName: message.pushName ?? null,
          }),
        });
        if (json?.inserted) log("info", "pesan developer masuk Global Chat:", body.slice(0, 60));
        else if (json?.reason) log("info", `pesan dilewati: ${json.reason}`);
      } catch (error) {
        log("error", "gagal mengirim pesan ke website", String(error?.message ?? error));
      }
    }
  });

  setInterval(() => {
    if (state.status === "connected") void reportStatus("connected");
  }, HEARTBEAT_MS);

  setInterval(() => void deliverPending(), POLL_MS);
}

process.on("unhandledRejection", (error) => log("error", "unhandledRejection", String(error)));
process.on("uncaughtException", (error) => log("error", "uncaughtException", String(error?.stack ?? error)));

log("info", `memulai SPACEPRS → ${APP_URL}`);
await reportStatus("connecting");
await connect();
