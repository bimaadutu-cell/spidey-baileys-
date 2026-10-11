"use client";

import { useCallback, useEffect, useState } from "react";
import { BotConfigPanel, type BotConfigDto } from "./bot-config-panel";

type AdminData = {
  ok: boolean;
  error?: string;
  stats: {
    presets: number;
    creators: number;
    withXml: number;
    withFiveMb: number;
    complete: number;
    pending: number;
    reviews: number;
    chatMessages: number;
  };
  database: { ok: boolean; latencyMs: number; error: string | null };
  bimz: { configured: boolean; reachable: boolean; message: string };
  bimzUpstream: { configured: boolean; reachable: boolean; indexed: number | null; message: string };
  botConfig: BotConfigDto;
  bot: {
    status: string;
    live: boolean;
    phone: string | null;
    pairingCode: string | null;
    lastHeartbeatAt: string | null;
  } | null;
  deliveries: {
    id: string;
    reviewId: string | null;
    target: string;
    status: string;
    attempts: number;
    lastError: string | null;
    sentAt: string | null;
    createdAt: string;
  }[];
  jobs: {
    id: string;
    type: string;
    status: string;
    provider: string | null;
    found: number;
    scanned: number;
    attempts: number;
    error: string | null;
    createdAt: string;
  }[];
  attempts: { id: string; stage: string; provider: string | null; ok: boolean; statusCode: number | null; message: string; createdAt: string }[];
  activity: { id: string; actor: string; action: string; level: string; detail: string | null; createdAt: string }[];
  scanOutcome: { ok: number; failed: number };
};

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card-3d rounded-2xl p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok === null ? "bg-slate-500" : ok ? "bg-white" : "bg-red-400"}`}
    />
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("preset alight motion");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin", { cache: "no-store" });
      const payload = (await res.json()) as AdminData;
      if (!res.ok || !payload.ok) {
        setError(payload.error ?? "Gagal memuat data admin");
        return;
      }
      setData(payload);
      setError(null);
    } catch {
      setError("Koneksi gagal");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const runAction = async (path: string, body: unknown, label: string) => {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string; message?: string; retried?: number };
      setNotice(payload.ok ? payload.message ?? `${label} selesai` : payload.error ?? `${label} gagal`);
      await load();
    } catch {
      setNotice(`${label} gagal (koneksi)`);
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="card-3d rounded-3xl p-8 text-center">
        <p className="text-2xl">⛔</p>
        <h1 className="mt-3 text-xl font-bold">Akses admin ditolak</h1>
        <p className="mt-2 text-sm text-slate-400">{error}</p>
        <p className="mt-3 text-xs text-slate-500">
          Akun admin dibootstrap lewat variabel server ADMIN_USERNAME / ADMIN_PASSWORD, atau akun pertama dengan
          username yang sama otomatis mendapat role admin.
        </p>
      </div>
    );
  }

  if (!data) return <div className="skeleton h-96 rounded-3xl" />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold neon-text">Admin Dashboard</h1>
          <p className="mt-1 text-xs text-slate-500">
            Semua angka diambil langsung dari database & provider nyata. Kredensial tidak pernah ditampilkan.
          </p>
        </div>
        <button onClick={() => void load()} className="btn !text-xs">
          ⟳ Refresh
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Preset" value={data.stats.presets} />
        <Stat label="Kreator" value={data.stats.creators} />
        <Stat label="XML ditemukan" value={data.stats.withXml} />
        <Stat label="5MB ditemukan" value={data.stats.withFiveMb} />
        <Stat label="Lengkap" value={data.stats.complete} hint="XML + 5MB" />
        <Stat label="Perlu retry" value={data.stats.pending} />
        <Stat label="Ulasan" value={data.stats.reviews} />
        <Stat label="Pesan chat" value={data.stats.chatMessages} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="card-3d rounded-2xl p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Dot ok={data.database.ok} /> Database
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {data.database.ok ? `Terhubung (${data.database.latencyMs}ms)` : `Gagal: ${data.database.error ?? "unknown"}`}
          </p>
        </div>
        <div className="card-3d rounded-2xl p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Dot ok={data.bimz.configured && data.bimz.reachable ? true : data.bimz.configured ? false : null} /> Resolver Bimz
          </p>
          <p className="mt-2 text-xs text-slate-400">{data.bimz.message}</p>
          <p className="mt-1 text-[11px] text-slate-500">Indeks Bimz: {data.bimzUpstream.message}</p>
        </div>
        <div className="card-3d rounded-2xl p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Dot ok={data.bot?.live ? true : false} /> WhatsApp Bot (SPACEPRS)
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Status: {data.bot?.status ?? "belum pernah berjalan"}
            {data.bot?.phone ? ` · ${data.bot.phone}` : ""}
            {data.bot?.pairingCode ? ` · pairing code ${data.bot.pairingCode}` : ""}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {data.bot?.live
              ? "Heartbeat aktif."
              : "Worker belum berjalan / heartbeat kedaluwarsa — jalankan server/workers/whatsapp-bot.mjs."}
          </p>
        </div>
      </section>

      <BotConfigPanel config={data.botConfig} bot={data.bot} onReload={() => void load()} />

      <section className="card-3d rounded-3xl p-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Aksi scanner</h2>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">
            <span className="mb-1 block uppercase tracking-[0.16em]">Keyword scan</span>
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className="w-64 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/35"
            />
          </label>
          <button
            disabled={busy !== null}
            onClick={() => void runAction("/api/scan?mode=keyword", { keyword, count: 12 }, "Keyword scan")}
            className="btn btn-primary !text-xs"
          >
            {busy === "Keyword scan" ? "Memindai…" : "Jalankan scan"}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => void runAction("/api/scan?mode=retry", { limit: 5 }, "Retry scan")}
            className="btn !text-xs"
          >
            {busy === "Retry scan" ? "Memproses…" : "Retry scan queue"}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => void runAction("/api/admin", { action: "bulk_harvest", maxQueries: 40 }, "Bulk harvest")}
            className="btn !text-xs"
          >
            {busy === "Bulk harvest" ? "Memanen…" : "Ambil semua preset (bulk harvest)"}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => void runAction("/api/admin", { action: "deep_scan", limit: 10 }, "Deep scan")}
            className="btn btn-primary !text-xs"
          >
            {busy === "Deep scan" ? "Memindai XML…" : "Deep scan preset (RestAPI Bimz)"}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => void runAction("/api/admin", { action: "backfill" }, "Sinkron status")}
            className="btn !text-xs"
          >
            {busy === "Sinkron status" ? "Menyinkron…" : "Sinkron status link"}
          </button>
        </div>
        {notice ? <p className="mt-3 text-xs text-slate-300">{notice}</p> : null}
      </section>

      <section className="card-3d rounded-3xl p-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
          Pengiriman WhatsApp ({data.deliveries.length})
        </h2>
        <div className="mt-3 space-y-2">
          {data.deliveries.length === 0 ? (
            <p className="text-xs text-slate-500">Belum ada antrean pengiriman.</p>
          ) : (
            data.deliveries.map((delivery) => (
              <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="text-slate-200">
                    {delivery.status} → {delivery.target}
                  </p>
                  <p className="truncate text-slate-500">
                    review {delivery.reviewId ?? "-"} · percobaan {delivery.attempts}
                    {delivery.lastError ? ` · ${delivery.lastError}` : ""}
                  </p>
                </div>
                <button
                  disabled={busy !== null}
                  onClick={() => void runAction("/api/admin", { action: "retry_delivery", id: delivery.id }, "Retry delivery")}
                  className="btn !py-1 !text-[11px]"
                >
                  Retry
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="card-3d rounded-3xl p-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Scan jobs</h2>
          <ul className="mt-3 space-y-2 text-xs">
            {data.jobs.map((job) => (
              <li key={job.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <p className="text-slate-200">
                  {job.type} · {job.status} · {job.provider ?? "-"}
                </p>
                <p className="text-slate-500">
                  ditemukan {job.found} · dipindai {job.scanned} · {new Date(job.createdAt).toLocaleString("id-ID")}
                </p>
                {job.error ? <p className="mt-1 text-red-300">{job.error}</p> : null}
              </li>
            ))}
            {data.jobs.length === 0 ? <li className="text-slate-500">Belum ada job.</li> : null}
          </ul>
        </div>

        <div className="card-3d rounded-3xl p-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Scan attempts (ok {data.scanOutcome.ok} / gagal {data.scanOutcome.failed})
          </h2>
          <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto text-[11px]">
            {data.attempts.map((attempt) => (
              <li key={attempt.id} className="rounded-lg border border-white/8 bg-white/4 px-2.5 py-1.5">
                <span className={attempt.ok ? "text-emerald-200" : "text-red-300"}>{attempt.ok ? "OK " : "GAGAL "}</span>
                <span className="text-slate-300">{attempt.stage}</span>
                <span className="text-slate-500"> · {attempt.provider ?? "-"}{attempt.statusCode ? ` · ${attempt.statusCode}` : ""}</span>
                <p className="text-slate-500">{attempt.message}</p>
              </li>
            ))}
            {data.attempts.length === 0 ? <li className="text-slate-500">Belum ada attempt.</li> : null}
          </ul>
        </div>
      </section>

      <section className="card-3d rounded-3xl p-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Log aktivitas</h2>
        <ul className="mt-3 space-y-1 text-[11px] text-slate-400">
          {data.activity.map((entry) => (
            <li key={entry.id}>
              <span className="text-slate-300">{entry.actor}</span> · {entry.action}
              {entry.detail ? ` · ${entry.detail}` : ""} · {new Date(entry.createdAt).toLocaleString("id-ID")}
            </li>
          ))}
          {data.activity.length === 0 ? <li className="text-slate-500">Belum ada aktivitas.</li> : null}
        </ul>
      </section>
    </div>
  );
}
