"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "./avatar";

export type WorkerSnapshot = {
  inProcess: boolean;
  supported: boolean;
  environmentNote: string;
  status: string;
  phone: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  lastError: string | null;
  reconnectAttempts?: number;
  uptimeSec: number;
  logs: { at: string; level: string; message: string }[];
};

export type BotConfigDto = {
  botNumber: string;
  targetNumber: string;
  displayName: string;
  globalChatEnabled: boolean;
  reviewNotifyEnabled: boolean;
  platform: string;
  browser: string;
  integration: string;
  source: "panel" | "env";
};

export function BotConfigPanel({
  config,
  bot,
  onReload,
}: {
  config: BotConfigDto | null;
  bot: { status: string; live: boolean; phone: string | null; pairingCode: string | null } | null;
  onReload: () => void;
}) {
  const [botNumber, setBotNumber] = useState(config?.botNumber ?? "");
  const [targetNumber, setTargetNumber] = useState(config?.targetNumber ?? "");
  const [displayName, setDisplayName] = useState(config?.displayName ?? "");
  const [globalChat, setGlobalChat] = useState(config?.globalChatEnabled ?? true);
  const [reviewNotify, setReviewNotify] = useState(config?.reviewNotifyEnabled ?? true);
  const [integration, setIntegration] = useState(config?.integration ?? "SPACEPRS");
  const [platform, setPlatform] = useState(config?.platform ?? "Ubuntu 22.04");
  const [browser, setBrowser] = useState(config?.browser ?? "Chrome");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerSnapshot | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairMsg, setPairMsg] = useState<string | null>(null);

  const loadWorker = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bot", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; worker?: WorkerSnapshot };
      if (data.ok && data.worker) setWorker(data.worker);
    } catch {
      /* panel keeps last known state */
    }
  }, []);

  useEffect(() => {
    void loadWorker();
    const timer = setInterval(() => void loadWorker(), 5000);
    return () => clearInterval(timer);
  }, [loadWorker]);

  const botAction = useCallback(
    async (action: "pair" | "stop" | "reset" | "pump") => {
      setPairing(action === "pair");
      setPairMsg(null);
      try {
        const res = await fetch("/api/admin/bot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, phone: botNumber || undefined }),
        });
        const data = (await res.json()) as { ok: boolean; message?: string; worker?: WorkerSnapshot };
        setPairMsg(data.message ?? (data.ok ? "ok" : "gagal"));
        if (data.worker) setWorker(data.worker);
        onReload();
      } catch {
        setPairMsg("Koneksi gagal");
      } finally {
        setPairing(false);
      }
    },
    [botNumber, onReload],
  );

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_bot_config",
          botConfig: {
            botNumber,
            targetNumber: targetNumber || botNumber,
            displayName,
            globalChatEnabled: globalChat,
            reviewNotifyEnabled: reviewNotify,
            integration,
            platform,
            browser,
          },
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      setMessage(data.ok ? (data.message ?? "Tersimpan") : (data.error ?? "Gagal"));
      if (data.ok) onReload();
    } catch {
      setMessage("Koneksi gagal");
    } finally {
      setBusy(false);
    }
  };

  const ingest = async () => {
    setIngestMsg(null);
    if (!targetUrl.trim()) return;
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "ingest_url", url: targetUrl.trim() }),
    });
    const data = (await res.json()) as { ok: boolean; message?: string; error?: string; presetId?: string | null };
    setIngestMsg(
      data.ok ? `${data.message} — preset ${data.presetId}` : (data.error ?? "Ingest gagal"),
    );
    if (data.ok) {
      setTargetUrl("");
      onReload();
    }
  };

  return (
    <section className="card-3d rounded-3xl p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Konfigurasi Bot WhatsApp
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Disimpan di database — berlaku setelah restart/redeploy, tanpa mengubah environment variable.
          </p>
        </div>
        <span className="chip" data-active={config?.source === "panel"}>
          sumber: {config?.source === "panel" ? "panel admin" : "environment"}
        </span>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Nomor bot (untuk pairing &amp; pengirim)
          </span>
          <input
            value={botNumber}
            onChange={(event) => setBotNumber(event.target.value.replace(/\D/g, ""))}
            placeholder="6283115955196"
            inputMode="numeric"
            className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 font-mono text-sm outline-none focus:border-white/35"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Nomor tujuan laporan ulasan
          </span>
          <input
            value={targetNumber}
            onChange={(event) => setTargetNumber(event.target.value.replace(/\D/g, ""))}
            placeholder="kosongkan = sama dengan nomor bot"
            inputMode="numeric"
            className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 font-mono text-sm outline-none focus:border-white/35"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Nama tampilan di Global Chat
          </span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="BimzOfficial ✓"
            className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Nama integrasi
          </span>
          <input
            value={integration}
            onChange={(event) => setIntegration(event.target.value)}
            placeholder="SPACEPRS"
            className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Platform worker (lokasi aktif)
          </span>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            className="w-full rounded-xl border border-white/12 bg-[#0b0b11] px-3.5 py-2.5 text-sm text-slate-200 outline-none"
          >
            {["Ubuntu 22.04", "Ubuntu 24.04", "Debian 12", "Windows", "macOS"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Browser pairing (Baileys)
          </span>
          <select
            value={browser}
            onChange={(event) => setBrowser(event.target.value)}
            className="w-full rounded-xl border border-white/12 bg-[#0b0b11] px-3.5 py-2.5 text-sm text-slate-200 outline-none"
          >
            {["Chrome", "Ubuntu", "Chromium", "Edge", "Firefox"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="chip cursor-pointer" data-active={globalChat}>
          <input
            type="checkbox"
            checked={globalChat}
            onChange={(event) => setGlobalChat(event.target.checked)}
            className="mr-1.5 accent-white"
          />
          Global Chat aktif
        </label>
        <label className="chip cursor-pointer" data-active={reviewNotify}>
          <input
            type="checkbox"
            checked={reviewNotify}
            onChange={(event) => setReviewNotify(event.target.checked)}
            className="mr-1.5 accent-white"
          />
          Kirim laporan ulasan (PNG)
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => void save()} disabled={busy || botNumber.length < 8} className="btn btn-primary !text-xs">
          {busy ? "Menyimpan…" : "Simpan konfigurasi"}
        </button>
        <span className="text-[11px] text-slate-500">
          Preview avatar bot: <Avatar seed={botNumber || "spaceprs"} size={22} className="inline-block align-middle" />
        </span>
      </div>

      {message ? <p className="mt-3 text-xs text-slate-300">{message}</p> : null}

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Worker WhatsApp (di dalam website)</p>
          <span className="chip" data-active={worker?.status === "connected"}>
            {worker?.status ?? "disconnected"}
          </span>
        </div>

        {worker && !worker.supported ? (
          <p className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-2.5 text-[11px] text-amber-200">
            {worker.environmentNote}
          </p>
        ) : null}

        <div className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
          <p className="text-slate-300">Nomor: {worker?.phone ?? bot?.phone ?? "—"}</p>
          <p className="text-slate-300">Uptime: {worker?.uptimeSec ?? 0}s</p>
          <p className="text-slate-300">Platform: {config?.platform} · {config?.browser}</p>
          <p className="text-slate-300">Error: {worker?.lastError ?? "—"}</p>
          <p className="text-slate-300">Reconnect: {worker?.reconnectAttempts ?? 0}×</p>
        </div>

        {worker?.pairingCode ? (
          <div className="mt-3 rounded-xl border border-white/25 bg-white/10 p-3 text-center">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Pairing code</p>
            <p className="mt-1 font-mono text-3xl font-black tracking-[0.35em] text-white">{worker.pairingCode}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              WhatsApp → Perangkat tertaut → Tautkan dengan nomor telepon → masukkan kode ini.
            </p>
            <p className="mt-1 text-[11px] text-amber-200">
              Setelah kode diterima, WhatsApp memutus socket sekali (kode 515) — itu normal. Sistem menyambung ulang
              otomatis; tunggu status berubah menjadi <strong>connected</strong>.
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => void botAction("pair")} disabled={pairing} className="btn btn-primary !text-xs">
            {pairing ? "Meminta…" : "Minta pairing code"}
          </button>
          <button onClick={() => void botAction("pump")} className="btn !text-xs">Proses antrean ulasan</button>
          <button onClick={() => void botAction("stop")} className="btn !text-xs">Hentikan</button>
          <button onClick={() => void botAction("reset")} className="btn !text-xs">Reset sesi</button>
        </div>

        {pairMsg ? <p className="mt-2 break-words text-xs text-slate-300">{pairMsg}</p> : null}

        {worker?.logs?.length ? (
          <ul className="mt-3 max-h-32 space-y-0.5 overflow-y-auto text-[10px] text-slate-500">
            {worker.logs.map((entry, index) => (
              <li key={index}>
                <span className={entry.level === "error" ? "text-red-300" : entry.level === "warn" ? "text-amber-300" : "text-slate-400"}>
                  {entry.level}
                </span>{" "}
                {entry.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/4 p-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Tambah preset dari URL TikTok</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            placeholder="https://www.tiktok.com/@zhon.softspoken/video/7693527226200968469"
            className="min-w-56 flex-1 rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
          />
          <button onClick={() => void ingest()} disabled={targetUrl.trim().length < 10} className="btn !text-xs">
            Ingest &amp; scan
          </button>
        </div>
        {ingestMsg ? <p className="mt-2 break-words text-xs text-slate-300">{ingestMsg}</p> : null}
      </div>
    </section>
  );
}

async function runAction(path: string, body: unknown, label: string, setMsg: (value: string) => void) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
    setMsg(`${label}: ${data.ok ? data.message ?? "ok" : data.error ?? "gagal"}`);
  } catch {
    setMsg(`${label}: koneksi gagal`);
  }
}
