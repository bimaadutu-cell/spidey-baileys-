/**
 * Strict gate deciding which WhatsApp messages may appear in Global Chat as
 * "developer" messages.
 *
 * Accepted ONLY when ALL of these hold:
 *   1. It is a PRIVATE 1:1 chat (never a group, broadcast, status or channel).
 *   2. The other side of that chat is the developer number.
 *        - incoming  : the developer wrote to the bot            (fromMe = false)
 *        - self-chat : bot is paired WITH the developer number and the developer
 *                      typed in "Message yourself"                (fromMe = true,
 *                      chat == own number)
 *   3. The message is fresh (not an offline-history replay).
 *   4. It was not sent by the bot itself (relay / tickets / pings / reviews).
 *
 * Everything else — friends, groups, other people DMing the bot, the developer
 * chatting with someone else from the same phone, bot echoes — is dropped.
 */

export type GateInput = {
  /** key.remoteJid */
  remoteJid: string | null;
  /** Alternate phone-number JIDs Baileys may supply for @lid chats. */
  altJids?: (string | null | undefined)[];
  fromMe: boolean;
  messageId: string | null;
  /** Unix seconds (messageTimestamp) */
  timestamp?: number | null;
  body: string;
  /** Digits of the number the bot is paired with. */
  botPhone: string;
  /** All accepted developer numbers (any format). */
  developerNumbers: string[];
  /** Optional resolver LID -> phone digits (Baileys lidMapping). */
  resolveLid?: (lid: string) => string | null | undefined;
};

export type GateResult = { ok: true; chatDigits: string } | { ok: false; reason: string };

const MAX_AGE_SEC = 180;

/** Normalizes Indonesian phone formats so equality is EXACT (no suffix guessing). */
export function normalizePhone(value: string | null | undefined): string {
  if (!value) return "";
  const raw = value.split("@")[0]?.split(":")[0] ?? "";
  let d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8") && d.length >= 9 && d.length <= 12) d = `62${d}`;
  return d;
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  return Boolean(x) && x === y;
}

/** IDs of messages this process sent itself (outbound echo protection). */
const globalForGate = globalThis as typeof globalThis & {
  __waSentIds?: Map<string, number>;
  __waLearnedLids?: Map<string, string>;
};
const sentIds = (globalForGate.__waSentIds ??= new Map());
const learnedLids = (globalForGate.__waLearnedLids ??= new Map());

export function rememberSentMessage(id: string | null | undefined): void {
  if (!id) return;
  sentIds.set(id, Date.now());
  if (sentIds.size > 500) {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [key, at] of sentIds) if (at < cutoff) sentIds.delete(key);
  }
}

export function wasSentByBot(id: string | null | undefined): boolean {
  return Boolean(id && sentIds.has(id));
}

/** Outbound bot templates must never come back as chat. */
export function isBotTemplate(body: string): boolean {
  const t = body.trim();
  return (
    /^🛠️\s*\*?LAPORAN/i.test(t) ||
    /^\*?LAPORAN KENDALA/i.test(t) ||
    /^🔔\s*\*?Private Ping/i.test(t) ||
    /^💬\s*\*?Global Chat/i.test(t) ||
    /预设空间\s*\|\s*Preset Space/i.test(t) ||
    /^Balas dengan:\s*#balas/i.test(t) ||
    /_Balas pesan ini begitu saja/i.test(t)
  );
}

export function evaluateDeveloperMessage(input: GateInput): GateResult {
  const jid = input.remoteJid ?? "";
  if (!jid) return { ok: false, reason: "tanpa remoteJid" };

  // 1) private chats only
  if (jid.endsWith("@g.us")) return { ok: false, reason: "grup diabaikan" };
  if (jid.endsWith("@broadcast") || jid === "status@broadcast") return { ok: false, reason: "broadcast/status diabaikan" };
  if (jid.endsWith("@newsletter")) return { ok: false, reason: "channel diabaikan" };
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid")) return { ok: false, reason: `tipe chat tidak didukung (${jid.split("@")[1] ?? "?"})` };

  // 4) bot echoes
  if (wasSentByBot(input.messageId)) return { ok: false, reason: "pesan kiriman bot sendiri" };
  if (isBotTemplate(input.body)) return { ok: false, reason: "template sistem bot" };

  // 3) freshness
  if (input.timestamp && input.timestamp > 0) {
    const ageSec = Date.now() / 1000 - input.timestamp;
    if (ageSec > MAX_AGE_SEC) return { ok: false, reason: `pesan lama (${Math.round(ageSec)}s) — replay riwayat` };
  }

  // Resolve the peer's phone number for this chat.
  let chatDigits = "";
  if (jid.endsWith("@s.whatsapp.net")) {
    chatDigits = normalizePhone(jid);
  } else {
    const lid = jid;
    chatDigits =
      learnedLids.get(lid) ??
      normalizePhone((input.altJids ?? []).find((j) => j && j.endsWith("@s.whatsapp.net"))) ??
      "";
    if (!chatDigits) chatDigits = normalizePhone(input.resolveLid?.(lid) ?? "");
    if (!chatDigits) return { ok: false, reason: `LID ${lid} belum bisa dipetakan ke nomor` };
  }

  const developerList = input.developerNumbers.map(normalizePhone).filter(Boolean);
  const isDeveloperChat = developerList.includes(chatDigits);
  if (!isDeveloperChat) return { ok: false, reason: `chat dengan ${chatDigits || "?"} bukan nomor developer` };

  if (jid.endsWith("@lid") && chatDigits) learnedLids.set(jid, chatDigits);

  // 2) direction
  const botIsDeveloper = developerList.includes(normalizePhone(input.botPhone));
  if (input.fromMe) {
    // Messages sent FROM the paired phone. Only the developer's own "Message yourself"
    // chat qualifies, and only when the bot number really is the developer number.
    if (!botIsDeveloper) return { ok: false, reason: "fromMe tapi bot bukan nomor developer" };
    if (!samePhone(chatDigits, input.botPhone)) return { ok: false, reason: "fromMe ke chat lain (bukan self-chat)" };
  } else if (botIsDeveloper && samePhone(chatDigits, input.botPhone)) {
    // Incoming message inside our own self-chat: it is a mirror of what we sent. Skip.
    return { ok: false, reason: "mirror self-chat" };
  }

  return { ok: true, chatDigits };
}
