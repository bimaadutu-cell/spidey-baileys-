"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./hooks";
import { Avatar } from "./avatar";

export type ChatMessageDto = {
  id: string;
  source: string;
  authorName: string;
  authorJid: string | null;
  avatarKey: string | null;
  body: string;
  isDeveloper: boolean;
  createdAt: string;
};

type BotState = { status: string; live: boolean; phone: string | null; pairingCode: string | null } | null;

const TIME_FORMAT = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" });

export function GlobalChat({ onChanged }: { onChanged?: () => void }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [bot, setBot] = useState<BotState>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAtRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const node = listRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, []);

  const merge = useCallback((incoming: ChatMessageDto[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const map = new Map(prev.map((message) => [message.id, message]));
      for (const message of incoming) map.set(message.id, message);
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
    const newest = incoming.at(-1);
    if (newest) lastAtRef.current = newest.createdAt;
    scrollToBottom();
  }, []);

  const poll = useCallback(async () => {
    try {
      const query = lastAtRef.current ? `?since=${encodeURIComponent(lastAtRef.current)}` : "";
      const res = await fetch(`/api/chat${query}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; messages?: ChatMessageDto[]; bot?: BotState };
      if (data.ok) {
        merge(data.messages ?? []);
        setBot(data.bot ?? null);
      }
    } catch {
      /* transient — keep last known state */
    }
  }, [merge]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const source = new EventSource("/api/chat/stream");
    source.addEventListener("snapshot", (event) => {
      if (cancelled) return;
      const payload = JSON.parse((event as MessageEvent).data) as { messages: ChatMessageDto[]; bot: BotState };
      setMessages([]);
      lastAtRef.current = null;
      merge(payload.messages ?? []);
      setBot(payload.bot ?? null);
      setLoading(false);
      setLive(true);
    });
    source.addEventListener("message", (event) => {
      if (cancelled) return;
      merge([JSON.parse((event as MessageEvent).data) as ChatMessageDto]);
    });
    source.onerror = () => {
      setLive(false);
      // SSE unavailable (serverless) → polling fallback
      if (!pollRef.current) pollRef.current = setInterval(() => void poll(), 4000);
    };

    void poll();
    setLoading(false);

    return () => {
      cancelled = true;
      source.close();
      setLive(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, merge, poll]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !user) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        private?: boolean;
        message?: ChatMessageDto | null;
        error?: string;
        relay?: { delivered: boolean; note: string };
      };
      if (!data.ok) {
        setError(data.error ?? "Pesan gagal terkirim");
      } else if (data.private) {
        // "p" private ping — never appears in Global Chat
        setDraft("");
      } else if (data.message) {
        merge([data.message]);
        setDraft("");
        // Tell the user honestly whether the bot forwarded it to the developer.
      }
    } catch {
      setError("Koneksi gagal");
    } finally {
      setSending(false);
      onChanged?.();
    }
  };

  const botLabel = (() => {
    if (!bot) return "Online";
    if (bot.live) return "Online";
    if (bot.status === "waiting_pairing") return "Menyiapkan…";
    return "Offline";
  })();

  return (
    <>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="Buka Global Chat"
          className="glass-strong fixed bottom-20 right-4 z-50 flex h-14 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white transition hover:scale-105 md:bottom-6 md:right-6"
        >
          <span className="relative grid h-8 w-8 place-items-center rounded-full bg-white/15">
            💬
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          <span className="hidden sm:block">Global Chat</span>
        </button>
      ) : null}

      {open ? (
        <section
          className="glass-strong animate-float-in fixed inset-x-2 bottom-16 z-50 flex max-h-[76dvh] flex-col overflow-hidden rounded-3xl md:inset-x-auto md:bottom-6 md:right-6 md:h-[560px] md:max-h-[80dvh] md:w-[400px]"
          role="dialog"
          aria-label="Global Chat"
        >
          <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-bold text-white">
                Global Chat
                <span className={live ? "live-dot" : "h-2 w-2 rounded-full bg-slate-500"} />
              </p>
              <p className="truncate text-[11px] text-slate-400">{botLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => void poll()} className="rounded-full px-2 py-1 text-xs text-slate-300 hover:bg-white/10" title="Muat pesan terbaru">
                ⟳
              </button>
              <button onClick={() => setOpen(false)} className="rounded-full px-2.5 py-1 text-sm text-slate-300 hover:bg-white/10" aria-label="Tutup chat">
                ✕
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {loading && messages.length === 0 ? (
              <div className="space-y-2">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="skeleton h-12 w-4/5 rounded-2xl" />
                ))}
              </div>
            ) : null}

            {!loading && messages.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                <p className="text-2xl">✦</p>
                <p className="mt-2 font-semibold text-slate-200">Belum ada pesan</p>
                <p className="mt-1">
                  Chat komunitas Preset Space.
                </p>
              </div>
            ) : null}

            {messages.map((message) => {
              const mine = user && message.source === "website" && message.authorName === (user.displayName || user.username);
              return (
                <div key={message.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                  {message.source === "whatsapp" ? (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm">✓</span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <Avatar seed={message.avatarKey || message.authorName} size={32} />
                  )}
                  <div className={`max-w-[78%] rounded-2xl border px-3 py-2 text-[13px] leading-snug ${mine ? "border-white/40 bg-white/90 text-black" : "border-white/10 bg-white/5 text-slate-100"}`}>
                    <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold opacity-80">
                      {message.isDeveloper ? (
                        <span className="flex items-center gap-1">
                          {message.authorName.replace(/\s*✓\s*$/, "") || "BimzOfficial"}
                          <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-sky-400 text-[8px] font-black text-black">
                            ✓
                          </span>
                        </span>
                      ) : (
                        message.authorName
                      )}
                      {message.source === "whatsapp" ? <span className="rounded bg-white/15 px-1 text-[9px]">WA</span> : null}
                      <span className="font-normal opacity-60">{TIME_FORMAT.format(new Date(message.createdAt))}</span>
                    </p>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={send} className="safe-bottom border-t border-white/10 p-3">
            {error ? <p className="mb-2 text-[11px] text-red-300">{error}</p> : null}
                        <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={user ? "Tulis pesan…" : "Login untuk mengirim pesan"}
                disabled={!user}
                maxLength={600}
                className="flex-1 rounded-full border border-white/12 bg-white/5 px-4 py-2.5 text-sm outline-none transition focus:border-white/35 disabled:opacity-60"
              />
              <button type="submit" className="btn btn-primary !px-4 !py-2 !text-xs" disabled={!user || sending || !draft.trim()}>
                {sending ? "…" : "Kirim"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
