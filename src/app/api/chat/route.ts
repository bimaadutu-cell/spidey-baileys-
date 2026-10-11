import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { clientIp, fail, json, rateLimit, readJson, tooMany } from "@/server/http";
import { getBotConfig, getBotStatus, listMessages, postWebsiteMessage, type ChatDto } from "@/server/services/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* =========================================================================
 * Global Chat API — same contract as the reference implementation:
 *
 *   { ok, items[], latestId, signedIn, botOnline, enabled, source }
 *
 * `items[]` carries role/verified/avatarIndex so the client can render
 * developer messages (WhatsApp) and member messages identically everywhere.
 * =======================================================================*/

function avatarIndexOf(key: string | null, name: string): number {
  const seed = `${key ?? ""}${name}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return (hash % 8) + 1;
}

function toItem(message: ChatDto, index: number) {
  const developer = message.isDeveloper || message.source === "whatsapp";
  return {
    id: index,
    key: message.id,
    source: message.source,
    role: developer ? "developer" : "user",
    name: message.authorName,
    username: developer ? null : message.authorName,
    avatarIndex: developer ? null : avatarIndexOf(message.avatarKey, message.authorName),
    avatarKey: message.avatarKey ?? message.authorName,
    verified: developer,
    body: message.body,
    createdAt: message.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 80);

  const [messages, bot, user, cfg] = await Promise.all([
    listMessages({ since, limit }),
    getBotStatus(),
    getCurrentUser(),
    getBotConfig(),
  ]);

  const items = messages.map(toItem);

  return json({
    ok: true,
    items,
    messages, // kept for backwards compatibility with the existing client
    latestId: items.at(-1)?.createdAt ?? null,
    signedIn: Boolean(user),
    botOnline: bot.live,
    enabled: cfg.globalChatEnabled,
    source: "database",
    bot,
    serverTime: new Date().toISOString(),
  });
}

const schema = z.object({ body: z.string().min(1, "Pesan tidak boleh kosong").max(600) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("Login diperlukan untuk mengirim pesan", 401);
  if (!rateLimit(`chat:${user.id}:${clientIp(req)}`, 20, 60_000)) return tooMany();

  const cfg = await getBotConfig();
  if (!cfg.globalChatEnabled) return fail("Global Chat sedang dimatikan", 503);

  const parsed = schema.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Pesan tidak valid", 422);

  const rawBody = parsed.data.body;
  const isPrivatePing = rawBody.trim().toLowerCase() === "p";

  // Special private ping: "p" is forwarded to developer WhatsApp only —
  // it must NEVER appear in the public Global Chat.
  if (isPrivatePing) {
    let relay: { ok: boolean; error?: string } = { ok: false, error: "bot tidak aktif" };
    try {
      const { relayPrivatePingToDeveloper } = await import("@/server/services/whatsapp-runtime");
      relay = await relayPrivatePingToDeveloper({
        authorName: user.displayName || user.username,
        userId: user.id,
      });
    } catch (error) {
      relay = { ok: false, error: error instanceof Error ? error.message.slice(0, 120) : "relay gagal" };
    }

    return json(
      {
        ok: true,
        private: true,
        item: null,
        message: null,
        relay: {
          delivered: relay.ok,
          note: relay.ok
            ? "Pesan privat diteruskan ke WhatsApp developer (tidak tampil di Global Chat)."
            : `Gagal meneruskan ke developer: ${relay.error ?? "bot offline"}`,
        },
      },
      { status: 201 },
    );
  }

  const message = await postWebsiteMessage({
    userId: user.id,
    username: user.displayName || user.username,
    avatarKey: user.avatarKey,
    body: rawBody,
  });

  // Forward every (non-private) website message to the developer's WhatsApp.
  let relay: { ok: boolean; error?: string } = { ok: false, error: "bot tidak aktif" };
  try {
    const { relayChatToDeveloper } = await import("@/server/services/whatsapp-runtime");
    relay = await relayChatToDeveloper({
      authorName: user.displayName || user.username,
      body: rawBody,
    });
  } catch (error) {
    relay = { ok: false, error: error instanceof Error ? error.message.slice(0, 120) : "relay gagal" };
  }

  return json(
    {
      ok: true,
      item: toItem(message, 0),
      message,
      relay: {
        delivered: relay.ok,
        note: relay.ok
          ? "Pesan diteruskan ke WhatsApp developer."
          : `Pesan tersimpan, belum diteruskan: ${relay.error ?? "bot offline"}`,
      },
    },
    { status: 201 },
  );
}
