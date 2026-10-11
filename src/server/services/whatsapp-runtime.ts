import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { botRuntime } from "@/db/schema";
import { getBotConfig, ingestWhatsAppMessage, upsertBotRuntime } from "./chat";
import { claimDeliveries, markDelivery } from "./reviews";
import { renderReviewImage } from "./review-image";

/* =========================================================================
 * In-website WhatsApp worker (Baileys) — no external VPS required.
 *
 * The admin panel presses "Minta pairing code"; this module boots a real
 * Baileys socket inside the Node server, asks WhatsApp for a pairing code and
 * keeps the connection alive, forwarding developer messages into Global Chat
 * and delivering review PNGs.
 *
 * IMPORTANT RUNTIME NOTE
 * ----------------------
 * This requires a persistent Node process. It works on a VPS/Railway/Render/
 * Fly (and in this sandbox). On Vercel *serverless* functions a socket cannot
 * outlive the request, so `environmentSupportsWorker()` reports that honestly
 * and the panel shows the limitation instead of faking an online bot.
 * =======================================================================*/

type Sock = {
  ev: { on: (event: string, handler: (payload: unknown) => void) => void };
  requestPairingCode: (phone: string) => Promise<string>;
  sendMessage: (jid: string, content: unknown) => Promise<unknown>;
  logout: () => Promise<void>;
  end: (error?: Error) => void;
  user?: { id?: string } | null;
};

type RuntimeState = {
  sock: Sock | null;
  status: "disconnected" | "connecting" | "waiting_pairing" | "connected";
  phone: string | null;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  lastError: string | null;
  startedAt: number | null;
  deliveryTimer: ReturnType<typeof setInterval> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  booting: boolean;
  /** Reconnect attempts since the last successful "open". */
  reconnectAttempts: number;
  /** True when the operator pressed Stop/Reset — suppresses auto-reconnect. */
  manualStop: boolean;
  logs: { at: string; level: string; message: string }[];
};

const globalForWa = globalThis as typeof globalThis & { __spaceprsWa?: RuntimeState };

export const waState: RuntimeState =
  globalForWa.__spaceprsWa ??
  {
    sock: null,
    status: "disconnected",
    phone: null,
    pairingCode: null,
    pairingExpiresAt: null,
    lastError: null,
    startedAt: null,
    deliveryTimer: null,
    heartbeatTimer: null,
    booting: false,
    reconnectAttempts: 0,
    manualStop: false,
    logs: [],
  };
globalForWa.__spaceprsWa = waState;

function log(level: "info" | "warn" | "error", message: string): void {
  waState.logs.unshift({ at: new Date().toISOString(), level, message: message.slice(0, 300) });
  waState.logs = waState.logs.slice(0, 60);
}

export function environmentSupportsWorker(): { supported: boolean; reason: string } {
  // Any serverless platform kills the process between requests — Baileys needs a
  // long-lived TCP socket, so pairing/connection can never work here.
  const onVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";
  const onAwsLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
  const onNetlify = Boolean(process.env.NETLIFY);
  const onCloudflare = Boolean(process.env.CF_PAGES || process.env.CLOUDFLARE_WORKERS);
  const forced = (process.env.WA_FORCE_INPROCESS ?? "").toLowerCase() === "true";

  if (!forced && (onVercel || onAwsLambda || onNetlify || onCloudflare)) {
    const where = onVercel ? "Vercel" : onAwsLambda ? "AWS Lambda" : onNetlify ? "Netlify" : "Cloudflare";
    return {
      supported: false,
      reason:
        `${where} bersifat serverless — bot WhatsApp TIDAK BISA pairing/terhubung di sini. ` +
        `Deploy worker Baileys di host persisten (VPS Ubuntu / Railway / Render / Fly), set APP_URL=https://situs-kamu + INTERNAL_TOKEN yang sama, lalu jalankan: pm2 start ecosystem.config.cjs`,
    };
  }
  return { supported: true, reason: "Proses Node persisten terdeteksi — worker dapat berjalan di dalam website." };
}


/**
 * Builds the Baileys browser triple: [OS, Browser, OS version].
 *
 * WhatsApp validates this tuple when issuing a pairing code. The device then
 * shows up in "Linked devices" as e.g. "Chrome (Ubuntu 22.04)".
 * The integration name must NEVER be placed in here.
 */
export function buildBrowserIdentity(platform: string, browser: string): [string, string, string] {
  const raw = (platform || "Ubuntu 22.04").trim();
  // "Ubuntu 22.04" -> os "Ubuntu", version "22.04"
  const match = raw.match(/^([A-Za-z ]+?)\s*([\d][\d.]*)?$/);
  const os = (match?.[1] ?? "Ubuntu").trim() || "Ubuntu";
  const version = (match?.[2] ?? "22.04").trim() || "22.04";
  const name = (browser || "Chrome").trim() || "Chrome";
  return [os, name, version];
}


/** Waits until the Baileys websocket is ready enough to call requestPairingCode. */
async function waitForSocketReady(sock: Sock, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let connectingSeen = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(connectingSeen), timeoutMs);

    sock.ev.on("connection.update", (payload: unknown) => {
      const update = payload as { connection?: string; qr?: string; isNewLogin?: boolean };
      if (update.connection === "connecting" || update.qr) {
        connectingSeen = true;
        // Give the noise socket a moment to finish the noise handshake before pairing.
        setTimeout(() => {
          if (!settled && connectingSeen) finish(true);
        }, 2500);
      }
      if (update.connection === "open") {
        // Fully open — safe to request pairing code immediately.
        setTimeout(() => finish(true), 800);
      }
      if (update.connection === "close") {
        // Only fail if we never saw connecting/open.
        if (!connectingSeen) finish(false);
      }
    });
  });
}

/** Minimal silent logger so Baileys does not crash without pino. */
const silentLogger = {
  level: "silent" as const,
  child: () => silentLogger,
  trace: (..._args: unknown[]) => undefined,
  debug: (..._args: unknown[]) => undefined,
  info: (..._args: unknown[]) => undefined,
  warn: (..._args: unknown[]) => undefined,
  error: (..._args: unknown[]) => undefined,
  fatal: (..._args: unknown[]) => undefined,
};

/** "Chrome (Ubuntu 22.04)" — exactly what WhatsApp will display. */
function identityLabel(cfg: { platform: string; browser: string }): string {
  const [os, browser, version] = buildBrowserIdentity(cfg.platform, cfg.browser);
  return `${browser} (${os} ${version})`;
}

function sessionDir(): string {
  // turbopackIgnore: process.cwd() is runtime-only (session on disk), not a static asset path.
  const base = process.env.WA_SESSION_DIR?.trim()
    ? process.env.WA_SESSION_DIR.trim()
    : path.join(/* turbopackIgnore: true */ process.cwd(), ".spaceprs-session");
  const dir = base;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function textOf(message: Record<string, unknown> | null | undefined): string {
  if (!message) return "";
  const m = message as Record<string, { text?: string; caption?: string } | string | undefined>;
  if (typeof m.conversation === "string") return m.conversation;
  const ext = m.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return ext.text;
  const img = m.imageMessage as { caption?: string } | undefined;
  if (img?.caption) return img.caption;
  const vid = m.videoMessage as { caption?: string } | undefined;
  if (vid?.caption) return vid.caption;
  return "";
}

/** Delivers queued support tickets to the developer. */
async function pumpTickets(): Promise<void> {
  if (waState.status !== "connected" || !waState.sock) return;
  try {
    const { claimTicketNotifications, markTicketNotified } = await import("./support");
    const pending = await claimTicketNotifications(3);
    for (const item of pending) {
      try {
        const text =
          `🛠️ *LAPORAN KENDALA BARU*\n\n` +
          `*Tiket:* ${item.ticket.shortId}\n` +
          `*Dari:* ${item.ticket.username}\n` +
          `*Kategori:* ${item.ticket.category}\n` +
          `*Judul:* ${item.ticket.subject}\n\n` +
          `${item.ticket.body}\n\n` +
          `———\nBalas dengan:\n*#balas ${item.ticket.shortId} <jawaban anda>*`;
        const sent = await sendWhatsAppText(item.target, text);
        if (!sent.ok) throw new Error(sent.error ?? "gagal kirim");
        await markTicketNotified(item.logId, item.ticket.id, "sent");
        log("info", `Tiket ${item.ticket.shortId} terkirim ke developer`);
      } catch (error) {
        await markTicketNotified(
          item.logId,
          item.ticket.id,
          "failed",
          error instanceof Error ? error.message : "gagal",
        );
      }
    }
  } catch (error) {
    log("error", `Antrean tiket error: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function pumpDeliveries(): Promise<void> {
  if (waState.status !== "connected" || !waState.sock) return;
  void pumpTickets();
  try {
    const tasks = await claimDeliveries(3);
    for (const task of tasks) {
      try {
        const png = await renderReviewImage({
          reviewId: task.reviewId,
          username: task.review.username,
          rating: task.review.rating,
          body: task.review.body,
          createdAt: task.review.createdAt,
        });
        const jid = `${task.target.replace(/\D/g, "")}@s.whatsapp.net`;
        await waState.sock.sendMessage(jid, {
          image: png,
          caption:
            `预设空间 | Preset Space — NEW WEBSITE REVIEW\n` +
            `${task.review.username} · ${"★".repeat(task.review.rating)}\n\n${task.review.body}`,
        });
        await markDelivery(task.id, "sent");
        log("info", `Ulasan ${task.reviewId} terkirim ke ${task.target}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "gagal";
        await markDelivery(task.id, "failed", reason);
        log("error", `Gagal kirim ulasan ${task.reviewId}: ${reason}`);
      }
    }
  } catch (error) {
    log("error", `Antrean pengiriman error: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

/** Boots Baileys and requests a pairing code for the configured number. */
type ConnectOptions = { phone: string; requestPairing: boolean };

/** Boots (or re-boots) the Baileys socket. Reused by pairing AND reconnects. */
async function connectSocket(options?: ConnectOptions): Promise<{ pairingCode: string | null; error: string | null }> {
  const cfg = await getBotConfig();
  const phone = (options?.phone ?? waState.phone ?? cfg.botNumber).replace(/\D/g, "");
  const wantPairing = options?.requestPairing ?? false;

  const baileys = (await import("@whiskeysockets/baileys")) as unknown as {
    default?: (config: Record<string, unknown>) => Sock;
    makeWASocket?: (config: Record<string, unknown>) => Sock;
    useMultiFileAuthState: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
    fetchLatestBaileysVersion: () => Promise<{ version: number[] }>;
    DisconnectReason: Record<string, number>;
  };
  const makeWASocket = baileys.default ?? baileys.makeWASocket;
  if (typeof makeWASocket !== "function") throw new Error("Baileys tidak dapat dimuat");
  const DisconnectReason = baileys.DisconnectReason ?? {};

  // Tear down any previous socket so we never run two at once.
  try {
    waState.sock?.end(undefined);
  } catch {
    /* already closed */
  }

  const { state: authState, saveCreds } = await baileys.useMultiFileAuthState(sessionDir());
  const { version } = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] }));

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: silentLogger,
    // EXACT triple WhatsApp expects: [OS, Browser, OS version] -> Ubuntu / Chrome / 22.04
    browser: buildBrowserIdentity(cfg.platform, cfg.browser),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    // Without a keep-alive the socket silently dies behind NAT/proxies.
    keepAliveIntervalMs: 15_000,
    connectTimeoutMs: 90_000,
    defaultQueryTimeoutMs: 90_000,
    retryRequestDelayMs: 2_000,
    emitOwnEvents: true,
    getMessage: async () => undefined,
  });

  waState.sock = sock;
  waState.phone = phone;
  waState.startedAt = waState.startedAt ?? Date.now();

  sock.ev.on("creds.update", () => void saveCreds());

  sock.ev.on("connection.update", (payload: unknown) => {
    const update = payload as {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number } } };
    };
    void (async () => {
      if (update.connection === "open") {
        waState.status = "connected";
        waState.pairingCode = null;
        waState.booting = false;
        waState.reconnectAttempts = 0;
        const id = (sock.user?.id ?? "").split(":")[0];
        if (id) waState.phone = id;
        log("info", `WhatsApp tersambung sebagai ${waState.phone} (${identityLabel(cfg)})`);
        await upsertBotRuntime({
          status: "connected",
          phone: waState.phone,
          pairingCode: null,
          heartbeat: true,
          meta: { identity: identityLabel(cfg) },
        });
        if (!waState.deliveryTimer) {
          waState.deliveryTimer = setInterval(() => void pumpDeliveries(), 15_000);
        }
        if (!waState.heartbeatTimer) {
          waState.heartbeatTimer = setInterval(() => {
            if (waState.status === "connected") {
              void upsertBotRuntime({ status: "connected", phone: waState.phone, heartbeat: true });
            }
          }, 30_000);
        }
        void pumpDeliveries();
        return;
      }

      if (update.connection !== "close") return;

      const code = update.lastDisconnect?.error?.output?.statusCode;
      waState.booting = false;

      // 515 = restartRequired. WhatsApp ALWAYS closes the socket right after a
      // pairing code is accepted and expects an immediate reconnect with the
      // credentials it just wrote. Not handling this is exactly why the bot
      // appeared to "keep disconnecting" during pairing.
      const restartRequired = code === 515 || code === 428;
      const loggedOut = code === 401 || code === 403 || code === DisconnectReason.loggedOut;

      if (loggedOut) {
        waState.status = "disconnected";
        waState.lastError = "Sesi logout — perlu pairing ulang";
        waState.manualStop = true;
        log("error", "Sesi logout dari WhatsApp. Tekan 'Reset sesi' lalu pairing ulang.");
        await upsertBotRuntime({ status: "disconnected", pairingCode: null, meta: { code: code ?? null } });
        return;
      }

      if (waState.manualStop) {
        waState.status = "disconnected";
        await upsertBotRuntime({ status: "disconnected", meta: { code: code ?? null } });
        return;
      }

      waState.reconnectAttempts += 1;
      const attempt = waState.reconnectAttempts;
      if (attempt > 12) {
        waState.status = "disconnected";
        waState.lastError = `Gagal menyambung ulang setelah ${attempt - 1} percobaan (code ${code ?? "?"})`;
        log("error", waState.lastError);
        await upsertBotRuntime({ status: "disconnected", meta: { code: code ?? null } });
        return;
      }

      const delay = restartRequired ? 800 : Math.min(30_000, 1500 * 2 ** Math.min(attempt, 4));
      waState.status = "connecting";
      waState.lastError = `closed (${code ?? "unknown"})`;
      log(
        restartRequired ? "info" : "warn",
        restartRequired
          ? `Pairing diterima — menyambung ulang untuk menyelesaikan sesi (percobaan ${attempt})`
          : `Koneksi tertutup (${code ?? "unknown"}), menyambung ulang dalam ${Math.round(delay / 1000)}s (percobaan ${attempt})`,
      );
      await upsertBotRuntime({ status: "connecting", heartbeat: true, meta: { code: code ?? null, attempt } });

      setTimeout(() => {
        void connectSocket({ phone: waState.phone ?? phone, requestPairing: false }).catch((error) => {
          log("error", `Reconnect gagal: ${error instanceof Error ? error.message : "unknown"}`);
        });
      }, delay);
    })();
  });

  // Developer's normal WhatsApp messages -> Global Chat (no command needed).
  sock.ev.on("messages.upsert", (payload: unknown) => {
    const batch = payload as {
      messages?: {
        key?: { id?: string; remoteJid?: string; fromMe?: boolean };
        message?: Record<string, unknown>;
        pushName?: string;
      }[];
    };
    void (async () => {
      for (const message of batch.messages ?? []) {
        const body = textOf(message.message);
        if (!body) continue;
        const jid = message.key?.remoteJid ?? null;
        if (!jid || jid.endsWith("@broadcast")) continue;

        const fromMe = Boolean(message.key?.fromMe);
        // When the bot is paired to the developer's OWN number, anything they
        // type from their phone arrives as fromMe=true and `remoteJid` is the
        // recipient. Those are developer messages, so attribute them to the
        // bot number instead of the recipient.
        const effectiveJid = fromMe ? `${(waState.phone ?? "").replace(/\D/g, "")}@s.whatsapp.net` : jid;

        // "#balas <ticketId> <text>" answers a support ticket.
        const replyMatch = body.match(/^#balas\s+([0-9a-f-]{8,36})\s+([\s\S]+)$/i);
        if (replyMatch) {
          try {
            const { addDeveloperReply } = await import("./support");
            const result = await addDeveloperReply({
              ticketRef: replyMatch[1]!,
              body: replyMatch[2]!.trim(),
              whatsappId: message.key?.id ?? null,
            });
            log(result.ok ? "info" : "warn", `Balasan tiket: ${result.message}`);
          } catch (error) {
            log("error", `Balasan tiket gagal: ${error instanceof Error ? error.message : "unknown"}`);
          }
          continue;
        }

        const result = await ingestWhatsAppMessage({
          clientKey: message.key?.id ?? `${Date.now()}-${Math.random()}`,
          jid: effectiveJid,
          body,
          pushName: message.pushName ?? null,
          fromMe,
        });
        if (result.inserted) log("info", `Pesan developer masuk Global Chat: ${body.slice(0, 48)}`);
        else if (result.reason) log("info", `Pesan WA dilewati: ${result.reason}`);
      }
    })();
  });

  const creds = (authState as { creds?: { registered?: boolean } }).creds;

  if (!wantPairing || creds?.registered) {
    return { pairingCode: null, error: null };
  }

  // WhatsApp only accepts requestPairingCode once the websocket noise handshake is up.
  const socketReady = await waitForSocketReady(sock, 45_000);
  if (!socketReady) {
    return {
      pairingCode: null,
      error:
        "Socket WhatsApp tidak siap (timeout 45s). Cek koneksi server ke WhatsApp, pastikan host bukan serverless (Vercel), lalu tekan Reset sesi dan coba lagi.",
    };
  }

  // Extra settle time — pairing too early is a common cause of empty/failed codes.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  let code = "";
  let lastError = "";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      // Phone must be digits only, country code included, no leading +.
      const cleanPhone = phone.replace(/\D/g, "");
      if (cleanPhone.length < 8) {
        return { pairingCode: null, error: "Nomor bot tidak valid (minimal 8 digit, contoh 628xxxxxxxxxx)" };
      }
      code = await sock.requestPairingCode(cleanPhone);
      if (code) break;
      lastError = "pairing code kosong dari WhatsApp";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log("warn", `requestPairingCode percobaan ${attempt}/5 gagal: ${lastError}`);
      // Back off harder on rate-limit style errors.
      const delay = /rate|too many|429|403/i.test(lastError) ? 8000 * attempt : 3000 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (!code) {
    return {
      pairingCode: null,
      error:
        lastError ||
        "WhatsApp menolak pairing code. Reset sesi, pastikan nomor benar (format 62…), dan coba lagi setelah 1–2 menit.",
    };
  }

  const normalized = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const pretty = normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;

  waState.pairingCode = pretty;
  waState.pairingExpiresAt = Date.now() + 180_000;
  waState.status = "waiting_pairing";
  log("info", `Pairing code valid diterbitkan (${identityLabel(cfg)}): ${pretty}`);
  await upsertBotRuntime({
    status: "waiting_pairing",
    phone,
    pairingCode: pretty,
    pairingExpiresAt: new Date(waState.pairingExpiresAt),
    heartbeat: true,
    meta: { identity: identityLabel(cfg) },
  });

  return { pairingCode: pretty, error: null };
}

export async function startPairing(options: { phone?: string } = {}): Promise<{
  ok: boolean;
  pairingCode?: string | null;
  status: string;
  message: string;
}> {
  const env = environmentSupportsWorker();
  if (!env.supported) {
    await upsertBotRuntime({ status: "disconnected", meta: { reason: env.reason } });
    return { ok: false, status: "unsupported", message: env.reason };
  }
  if (waState.booting) {
    return {
      ok: true,
      status: waState.status,
      pairingCode: waState.pairingCode,
      message: "Proses pairing sedang berjalan…",
    };
  }
  if (waState.status === "connected") {
    return { ok: true, status: "connected", message: "Bot sudah tersambung." };
  }

  const cfg = await getBotConfig();
  const phone = (options.phone ?? cfg.botNumber).replace(/\D/g, "");
  if (phone.length < 8) {
    return { ok: false, status: waState.status, message: "Nomor bot belum diisi di panel admin." };
  }

  waState.booting = true;
  waState.manualStop = false;
  waState.reconnectAttempts = 0;
  waState.phone = phone;
  waState.lastError = null;
  waState.status = "connecting";
  await upsertBotRuntime({ status: "connecting", phone, heartbeat: true });
  log("info", `Memulai koneksi WhatsApp untuk ${phone} (${identityLabel(cfg)})`);

  try {
    // Wipe incomplete / corrupt session before a fresh pairing request so
    // Baileys does not try to resume a half-registered device.
    try {
      const dir = sessionDir();
      const credsPath = path.join(dir, "creds.json");
      if (fs.existsSync(credsPath)) {
        const raw = fs.readFileSync(credsPath, "utf8");
        const parsed = JSON.parse(raw) as { registered?: boolean; me?: unknown };
        if (!parsed.registered && !parsed.me) {
          fs.rmSync(dir, { recursive: true, force: true });
          log("info", "Sesi setengah jadi dibersihkan sebelum pairing baru");
        }
      }
    } catch {
      /* ignore cleanup errors */
    }

    const result = await connectSocket({ phone, requestPairing: true });
    waState.booting = false;

    if (result.error) {
      waState.status = "disconnected";
      waState.lastError = result.error;
      await upsertBotRuntime({ status: "disconnected", meta: { error: result.error } });
      return {
        ok: false,
        status: "disconnected",
        message: `WhatsApp menolak permintaan pairing: ${result.error}`,
      };
    }

    if (result.pairingCode) {
      return {
        ok: true,
        pairingCode: result.pairingCode,
        status: "waiting_pairing",
        message: `Pairing code: ${result.pairingCode} — buka WhatsApp → Perangkat tertaut → Tautkan dengan nomor telepon → masukkan kode. Perangkat tampil sebagai ${identityLabel(cfg)}. Jangan tutup panel sampai status "connected".`,
      };
    }

    return { ok: true, status: waState.status, message: "Sesi tersimpan ditemukan, menyambungkan kembali…" };
  } catch (error) {
    waState.booting = false;
    waState.status = "disconnected";
    waState.lastError = error instanceof Error ? error.message : "gagal";
    log("error", `Pairing gagal: ${waState.lastError}`);
    await upsertBotRuntime({ status: "disconnected", meta: { error: waState.lastError } });
    return { ok: false, status: "disconnected", message: `Gagal memulai bot: ${waState.lastError}` };
  }
}


/* ----------------------------------------------- outbound relay (web -> WA) */

/** Sends a plain text message from the bot session. */
export async function sendWhatsAppText(toNumber: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (waState.status !== "connected" || !waState.sock) {
    return { ok: false, error: "Bot belum tersambung" };
  }
  try {
    const jid = `${toNumber.replace(/\D/g, "")}@s.whatsapp.net`;
    await waState.sock.sendMessage(jid, { text });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 160) : "gagal kirim" };
  }
}

/**
 * Forwards a Global Chat message written on the website to the developer's
 * WhatsApp. Queued in the database first, so nothing is lost while offline.
 */
export async function relayChatToDeveloper(input: {
  authorName: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getBotConfig();
  if (!cfg.globalChatEnabled) return { ok: false, error: "Global Chat dimatikan" };
  const text = `💬 *Global Chat — ${input.authorName}*\n\n${input.body}\n\n_预设空间 | Preset Space_`;
  const result = await sendWhatsAppText(cfg.targetNumber || cfg.botNumber, text);
  if (result.ok) log("info", `Pesan web diteruskan ke developer: ${input.body.slice(0, 40)}`);
  else log("warn", `Gagal meneruskan pesan web: ${result.error}`);
  return result;
}

/**
 * Private "p" ping from Global Chat → developer WhatsApp only.
 * The message is NEVER stored or shown in the public Global Chat.
 * Developer can reply normally (no prefix); the reply appears in Global Chat
 * with BimzOfficial Developer branding + verified check.
 */
export async function relayPrivatePingToDeveloper(input: {
  authorName: string;
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getBotConfig();
  if (!cfg.globalChatEnabled) return { ok: false, error: "Global Chat dimatikan" };
  const text =
    `🔔 *Private Ping (p)* dari *${input.authorName}*\n` +
    `User ID: \`${input.userId}\`\n\n` +
    `_Balas pesan ini begitu saja (tanpa prefix) — balasanmu akan muncul di Global Chat sebagai BimzOfficial Developer ✓_`;
  const result = await sendWhatsAppText(cfg.targetNumber || cfg.botNumber, text);
  if (result.ok) log("info", `Private ping (p) diteruskan ke developer dari: ${input.authorName}`);
  else log("warn", `Gagal meneruskan private ping: ${result.error}`);
  return result;
}

export async function stopWorker(): Promise<{ ok: boolean; message: string }> {
  try {
    waState.manualStop = true; // suppress auto-reconnect
    if (waState.deliveryTimer) {
      clearInterval(waState.deliveryTimer);
      waState.deliveryTimer = null;
    }
    if (waState.heartbeatTimer) {
      clearInterval(waState.heartbeatTimer);
      waState.heartbeatTimer = null;
    }
    waState.sock?.end(undefined);
    waState.sock = null;
    waState.status = "disconnected";
    waState.pairingCode = null;
    await upsertBotRuntime({ status: "disconnected", pairingCode: null });
    log("info", "Worker dihentikan dari panel");
    return { ok: true, message: "Worker dihentikan." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "gagal" };
  }
}

export async function resetSession(): Promise<{ ok: boolean; message: string }> {
  await stopWorker();
  waState.reconnectAttempts = 0;
  waState.lastError = null;
  try {
    const dir = sessionDir();
    fs.rmSync(dir, { recursive: true, force: true });
    await db.update(botRuntime).set({ pairingCode: null, phone: null, status: "disconnected" }).where(eq(botRuntime.id, "whatsapp"));
    log("warn", "Sesi WhatsApp dihapus — pairing ulang diperlukan");
    return { ok: true, message: "Sesi dihapus. Minta pairing code baru." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "gagal" };
  }
}

export function workerSnapshot() {
  const env = environmentSupportsWorker();
  return {
    inProcess: true,
    supported: env.supported,
    environmentNote: env.reason,
    status: waState.status,
    phone: waState.phone,
    pairingCode: waState.status === "waiting_pairing" ? waState.pairingCode : null,
    pairingExpiresAt: waState.pairingExpiresAt ? new Date(waState.pairingExpiresAt).toISOString() : null,
    lastError: waState.lastError,
    reconnectAttempts: waState.reconnectAttempts,
    uptimeSec: waState.startedAt ? Math.round((Date.now() - waState.startedAt) / 1000) : 0,
    logs: waState.logs.slice(0, 15),
  };
}

export async function triggerDeliveryPump(): Promise<{ ok: boolean; message: string }> {
  if (waState.status !== "connected") {
    return { ok: false, message: "Bot belum tersambung — antrean tetap tersimpan." };
  }
  await pumpDeliveries();
  return { ok: true, message: "Antrean pengiriman diproses." };
}


/* --------------------------------------------------- auto-start on boot */

let autoStarted = false;

/**
 * Resumes the WhatsApp session automatically when the server starts, so the
 * bot keeps running without anyone opening /admin. Only resumes an EXISTING
 * paired session — a first-time pairing still needs the panel button.
 */
export async function autoStartWorker(): Promise<void> {
  if (autoStarted) return;
  autoStarted = true;

  const env = environmentSupportsWorker();
  if (!env.supported) return;

  try {
    const dir = sessionDir();
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const hasSession = files.some((file) => file.startsWith("creds"));
    if (!hasSession) {
      log("info", "Belum ada sesi tersimpan — tekan 'Minta pairing code' di /admin sekali saja.");
      return;
    }
    log("info", "Sesi tersimpan ditemukan — menyambungkan bot otomatis…");
    waState.manualStop = false;
    await connectSocket({ phone: waState.phone ?? "", requestPairing: false });
  } catch (error) {
    log("error", `Auto-start gagal: ${error instanceof Error ? error.message : "unknown"}`);
  }
}
