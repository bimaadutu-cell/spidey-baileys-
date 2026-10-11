"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReviewForm } from "./forms";
import { useSession } from "./hooks";

type Reply = { id: string; author: string; authorName: string; body: string; createdAt: string };
type Ticket = {
  id: string;
  shortId: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  notifyStatus: string;
  unread: boolean;
  createdAt: string;
  lastReplyAt: string | null;
  replies: Reply[];
};

const FMT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

export function FeedbackView() {
  const { user } = useSession();
  const [tab, setTab] = useState<"ulasan" | "kendala" | "kotak">("ulasan");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [unread, setUnread] = useState(0);

  const [category, setCategory] = useState("kendala");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/support", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; tickets?: Ticket[]; unread?: number };
      if (data.ok) {
        setTickets(data.tickets ?? []);
        setUnread(data.unread ?? 0);
      }
    } catch {
      /* keep last state */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", category, subject, body }),
      });
      const data = (await res.json()) as { ok: boolean; note?: string; error?: string };
      setMsg({ kind: data.ok ? "ok" : "err", text: data.note ?? data.error ?? "Selesai" });
      if (data.ok) {
        setSubject("");
        setBody("");
        await load();
        setTab("kotak");
      }
    } catch {
      setMsg({ kind: "err", text: "Koneksi gagal" });
    } finally {
      setBusy(false);
    }
  };

  const openTicket = async (ticket: Ticket) => {
    if (!ticket.unread) return;
    await fetch("/api/support", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", ticketId: ticket.id }),
    });
    await load();
  };

  return (
    <div className="space-y-6">
      <header className="card-3d rounded-[26px] p-6">
        <span className="chip">Pusat Umpan Balik</span>
        <h1 className="mt-3 text-2xl font-black neon-text sm:text-3xl">Ulasan &amp; Laporan Kendala</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Ulasan dan laporan kendala dikirim langsung ke WhatsApp developer oleh bot. Balasan developer masuk ke{" "}
          <strong className="text-slate-200">Kontak Masuk</strong> akun Anda.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={() => setTab("ulasan")} className="chip" data-active={tab === "ulasan"}>
            ★ Ulasan
          </button>
          <button onClick={() => setTab("kendala")} className="chip" data-active={tab === "kendala"}>
            🛠️ Laporan Kendala
          </button>
          <button onClick={() => setTab("kotak")} className="chip relative" data-active={tab === "kotak"}>
            📥 Kontak Masuk
            {unread > 0 ? (
              <span className="ml-1 inline-flex items-center gap-1">
                <span className="inbox-dot" />
                {unread}
              </span>
            ) : null}
          </button>
        </div>

        {unread > 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-3">
            <span className="inbox-dot" />
            <p className="text-sm font-semibold text-emerald-200">
              Balasan developer nih — {unread} pesan baru di Kontak Masuk
            </p>
            <button onClick={() => setTab("kotak")} className="btn !ml-auto !py-1 !text-[11px]">
              Lihat
            </button>
          </div>
        ) : null}
      </header>

      {tab === "ulasan" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReviewForm />
          <div className="card-3d rounded-3xl p-6">
            <h2 className="text-lg font-bold neon-text">Cara kerja ulasan</h2>
            <ol className="mt-3 space-y-2 text-sm text-slate-400">
              <li>1. Ulasan disimpan permanen ke PostgreSQL.</li>
              <li>2. Backend merender kartu ulasan menjadi gambar PNG.</li>
              <li>3. Bot WhatsApp mengirim PNG itu ke developer.</li>
              <li>4. Status pengiriman: queued → pending → sent.</li>
            </ol>
            <p className="mt-4 text-xs text-slate-500">
              3 ulasan bintang 5 yang berhasil terkirim membuka fitur{" "}
              <Link href="/premium-alight" className="underline">PremiumAlight</Link>.
            </p>
          </div>
        </div>
      ) : null}

      {tab === "kendala" ? (
        <form onSubmit={submit} className="card-3d rounded-3xl p-6">
          <h2 className="text-lg font-bold neon-text">Laporkan kendala</h2>
          <p className="mt-1 text-sm text-slate-400">
            Laporan diteruskan bot ke WhatsApp developer. Balasannya masuk ke Kontak Masuk Anda.
          </p>

          {!user ? (
            <p className="mt-4 rounded-2xl border border-white/12 bg-white/5 p-3 text-sm text-slate-300">
              Login dulu untuk mengirim laporan. <Link href="/login" className="underline">Login</Link>
            </p>
          ) : (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">Kategori</span>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="w-full rounded-xl border border-white/12 bg-[#0b0b11] px-3.5 py-2.5 text-sm text-slate-200 outline-none"
                  >
                    <option value="kendala">Kendala / Bug</option>
                    <option value="saran">Saran fitur</option>
                    <option value="lainnya">Lainnya</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">Judul</span>
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    required
                    minLength={4}
                    maxLength={120}
                    placeholder="Video tidak bisa diputar"
                    className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
                  />
                </label>
              </div>

              <label className="mt-3 block">
                <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">Deskripsi</span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  required
                  minLength={10}
                  maxLength={1500}
                  rows={5}
                  placeholder="Jelaskan kendalanya sedetail mungkin…"
                  className="w-full rounded-2xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
                />
              </label>

              {msg ? (
                <p className={`mt-3 text-xs ${msg.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>
              ) : null}

              <button type="submit" disabled={busy} className="btn btn-primary mt-4">
                {busy ? "Mengirim…" : "Kirim laporan"}
              </button>
            </>
          )}
        </form>
      ) : null}

      {tab === "kotak" ? (
        <section className="card-3d rounded-3xl p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold neon-text">
            Kontak Masuk
            {unread > 0 ? <span className="inbox-dot" /> : null}
          </h2>

          {!user ? (
            <p className="mt-3 text-sm text-slate-400">
              Login untuk melihat balasan developer. <Link href="/login" className="underline">Login</Link>
            </p>
          ) : tickets.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">
              Belum ada laporan. Kirim laporan kendala dan balasan developer akan tampil di sini.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  onClick={() => void openTicket(ticket)}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${
                    ticket.unread
                      ? "border-emerald-400/50 bg-emerald-400/10"
                      : "border-white/10 bg-white/4 hover:border-white/25"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {ticket.unread ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                        <span className="inbox-dot" /> Balasan developer nih
                      </span>
                    ) : null}
                    <span className="chip">#{ticket.shortId}</span>
                    <span className="chip">{ticket.category}</span>
                    <span className="chip">{ticket.status === "answered" ? "dijawab" : "menunggu"}</span>
                    <span className="ml-auto text-[11px] text-slate-500">{FMT.format(new Date(ticket.createdAt))}</span>
                  </div>

                  <p className="mt-2 text-sm font-semibold text-white">{ticket.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{ticket.body}</p>

                  {ticket.replies.length > 0 ? (
                    <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                      {ticket.replies.map((reply) => (
                        <div key={reply.id} className="rounded-xl border border-white/12 bg-white/8 p-3">
                          <p className="text-[11px] font-bold text-emerald-200">{reply.authorName}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{reply.body}</p>
                          <p className="mt-1 text-[10px] text-slate-500">{FMT.format(new Date(reply.createdAt))}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Notifikasi: {ticket.notifyStatus} · menunggu balasan developer
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
