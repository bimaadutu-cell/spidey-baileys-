"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Unlock = {
  unlocked: boolean;
  delivered: number;
  required: number;
  pending: number;
  remaining: number;
  note: string;
};

type Activation = {
  stage: string;
  email: string | null;
  plan: string | null;
  product: string | null;
  lastMessage: string | null;
  lastError: string | null;
  sentAt: string | null;
  verifiedAt: string | null;
  appliedAt: string | null;
} | null;

type PremiumData = {
  ok: boolean;
  authenticated: boolean;
  unlock: Unlock;
  activation: Activation;
  configured: boolean;
  upstream?: { ok: boolean; message: string; plan: unknown; quota: unknown };
};

const STAGE_STEP: Record<string, number> = { idle: 0, sent: 1, verified: 2, applied: 3, failed: 0 };

export function PremiumAlight() {
  const [data, setData] = useState<PremiumData | null>(null);
  const [email, setEmail] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [idToken, setIdToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/premium", { cache: "no-store" });
      const payload = (await res.json()) as PremiumData;
      setData(payload);
      if (payload.activation?.email && !email) setEmail(payload.activation.email);
    } catch {
      setMsg({ kind: "err", text: "Gagal memuat status Premium." });
    }
  }, [email]);

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch("/api/premium", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as {
        ok: boolean;
        message?: string;
        error?: string;
        idToken?: string | null;
      };
      setMsg({ kind: payload.ok ? "ok" : "err", text: payload.message ?? payload.error ?? "Selesai" });
      if (payload.idToken) {
        // idToken is filled into step 3 automatically after verification.
        setIdToken(payload.idToken);
        setMsg({
          kind: "ok",
          text: "Link terverifikasi — idToken otomatis terisi. Tekan 'Aktifkan Premium' untuk menyelesaikan.",
        });
      }
      await load();
    } catch {
      setMsg({ kind: "err", text: "Koneksi gagal." });
    } finally {
      setBusy(null);
    }
  };

  const unlock = data?.unlock;
  const step = STAGE_STEP[data?.activation?.stage ?? "idle"] ?? 0;
  const locked = !unlock?.unlocked;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ calling banner */}
      <div className="card-3d relative overflow-hidden rounded-[28px] p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <span className="chip animate-pulse">✦ PremiumAlight</span>
        <h1 className="mt-4 text-2xl font-black leading-tight neon-text sm:text-4xl">
          Ingin gunakan preset tapi AM belum premium?
          <br />
          <span className="text-slate-400">Ayo gunakan aku</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          Aktifkan <strong className="text-slate-200">Alight Motion Premium 1 Tahun</strong> langsung dari Preset Space
          lewat RestAPI Bimz ∆. Semua langkah dijalankan server-side; email login Anda tidak pernah disimpan sebagai
          token mentah.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="chip" data-active={!locked}>
            {locked ? "🔒 Terkunci" : "🔓 Terbuka"}
          </span>
          <span className="chip">
            Misi: {unlock?.delivered ?? 0}/{unlock?.required ?? 3} ulasan ★5 terkirim
          </span>
          {data?.activation?.stage === "applied" ? <span className="chip">✓ Premium aktif</span> : null}
        </div>
      </div>

      {/* --------------------------------------------------- mission gate */}
      {locked ? (
        <section className="card-3d rounded-3xl p-6">
          <h2 className="text-lg font-bold neon-text">Misi membuka fitur</h2>
          <p className="mt-2 text-sm text-slate-400">{unlock?.note}</p>

          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-slate-300 to-white transition-all duration-500"
              style={{ width: `${Math.min(100, ((unlock?.delivered ?? 0) / (unlock?.required ?? 3)) * 100)}%` }}
            />
          </div>

          <ol className="mt-5 space-y-2 text-sm text-slate-300">
            <li>1. Buka halaman utama, tulis ulasan terbaik Anda dengan rating <strong>bintang 5</strong>.</li>
            <li>2. Bot WhatsApp mengirim ulasan itu sebagai gambar PNG ke developer.</li>
            <li>3. Ulangi sampai <strong>{unlock?.required ?? 3} ulasan bintang 5</strong> berhasil terkirim.</li>
            <li>4. Fitur ini terbuka otomatis untuk akun Anda — tidak perlu minta manual.</li>
          </ol>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/#ulasan" className="btn btn-primary">Tulis ulasan bintang 5</Link>
            <button onClick={() => void load()} className="btn">⟳ Periksa progres</button>
          </div>

          {(unlock?.pending ?? 0) > 0 ? (
            <p className="mt-4 rounded-2xl border border-white/12 bg-white/5 p-3 text-xs text-slate-400">
              {unlock?.pending} ulasan ★5 sudah tersimpan tetapi notifikasinya belum terkirim. Pastikan bot WhatsApp
              online di <Link href="/admin" className="underline">/admin</Link>, lalu periksa lagi.
            </p>
          ) : null}
        </section>
      ) : (
        /* ------------------------------------------------ activation flow */
        <section className="card-3d rounded-3xl p-6">
          <h2 className="text-lg font-bold neon-text">Aktivasi Alight Motion Premium</h2>
          <p className="mt-1 text-xs text-slate-500">
            Alur resmi RestAPI Bimz ∆: <code className="rounded bg-white/10 px-1">send</code> →{" "}
            <code className="rounded bg-white/10 px-1">verif</code> →{" "}
            <code className="rounded bg-white/10 px-1">apply</code>
          </p>

          <div className="mt-4 flex gap-2">
            {["Kirim email", "Verifikasi link", "Aktifkan"].map((label, index) => (
              <div
                key={label}
                className={`flex-1 rounded-xl border p-2.5 text-center text-[11px] transition ${
                  step > index ? "border-white bg-white/90 font-semibold text-black" : "border-white/12 bg-white/5 text-slate-400"
                }`}
              >
                {index + 1}. {label}
              </div>
            ))}
          </div>

          {/* step 1 */}
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Langkah 1 — Email akun Alight Motion</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="email-akun-am@gmail.com"
                className="min-w-56 flex-1 rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
              />
              <button
                onClick={() => void call({ action: "send", email }, "send")}
                disabled={busy !== null || !email.includes("@")}
                className="btn btn-primary !text-xs"
              >
                {busy === "send" ? "Mengirim…" : "Kirim link login"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Alight Creative akan mengirim email dari <strong>noreply@alight-creative.firebaseapp.com</strong>.
              Proses ini bisa memakan waktu hingga ~1 menit — jika respons lambat, email biasanya tetap terkirim,
              cek inbox/spam lalu lanjut ke Langkah 2.
            </p>
          </div>

          {/* step 2 */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              Langkah 2 — Tempel link dari email
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://alight-creative.firebaseapp.com/__/auth/action?mode=signIn&oobCode=…"
                className="min-w-56 flex-1 rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 font-mono text-[11px] outline-none focus:border-white/35"
              />
              <button
                onClick={() => void call({ action: "verify", email, url: linkUrl }, "verify")}
                disabled={busy !== null || linkUrl.length < 20}
                className="btn !text-xs"
              >
                {busy === "verify" ? "Memverifikasi…" : "Verifikasi"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Buka email → tekan &ldquo;Sign in&rdquo; → salin seluruh URL dari address bar → tempel di sini.
            </p>
          </div>

          {/* step 3 */}
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              Langkah 3 — Aktifkan premium {idToken ? <span className="text-emerald-300">· idToken siap ✓</span> : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={idToken}
                onChange={(event) => setIdToken(event.target.value)}
                placeholder="idToken terisi otomatis setelah verifikasi"
                className={`min-w-56 flex-1 rounded-xl border bg-white/5 px-3.5 py-2.5 font-mono text-[11px] outline-none ${
                  idToken ? "border-emerald-400/60" : "border-white/12 focus:border-white/35"
                }`}
              />
              <button
                onClick={() => void call({ action: "apply", idToken }, "apply")}
                disabled={busy !== null || idToken.length < 20}
                className="btn btn-primary !text-xs"
              >
                {busy === "apply" ? "Mengaktifkan…" : "Aktifkan Premium"}
              </button>
            </div>
          </div>

          {msg ? (
            <p
              className={`mt-4 rounded-2xl border p-3 text-xs ${
                msg.kind === "ok" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200"
              }`}
            >
              {msg.text}
            </p>
          ) : null}

          {data?.activation?.stage === "applied" ? (
            <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4">
              <p className="text-sm font-bold text-white">✓ Premium aktif</p>
              <p className="mt-1 text-xs text-slate-300">
                {data.activation.product ?? "Alight Motion Premium 1 Tahun"} · diaktifkan{" "}
                {data.activation.appliedAt ? new Date(data.activation.appliedAt).toLocaleString("id-ID") : "-"}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Buka ulang aplikasi Alight Motion dan login dengan email yang sama untuk melihat status premium.
              </p>
            </div>
          ) : null}
        </section>
      )}

      {/* ------------------------------------------------------- handbook */}
      <section className="card-3d rounded-3xl p-6">
        <h2 className="text-lg font-bold neon-text">📘 Buku Panduan Aktivasi — RestAPI Bimz ∆</h2>

        <div className="mt-4 space-y-4 text-sm text-slate-300">
          <div>
            <p className="font-semibold text-white">A. Syarat</p>
            <ul className="mt-1.5 space-y-1 text-slate-400">
              <li>• Akun Preset Space sudah login.</li>
              <li>• Misi {unlock?.required ?? 3} ulasan bintang 5 sudah terkirim ke developer.</li>
              <li>• Punya email akun Alight Motion (yang dipakai login di aplikasi AM).</li>
              <li>• Akses ke inbox email tersebut.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-white">B. Langkah aktivasi</p>
            <ol className="mt-1.5 space-y-1 text-slate-400">
              <li>1. Masukkan email akun AM pada Langkah 1, tekan <em>Kirim link login</em>.</li>
              <li>2. Server memanggil <code className="rounded bg-white/10 px-1">action=send</code>; Firebase Alight Creative mengirim email sign-in.</li>
              <li>3. Buka email (cek folder spam/promosi), tekan tombol <em>Sign in</em>.</li>
              <li>4. Browser terbuka — salin <strong>seluruh URL</strong> di address bar.</li>
              <li>5. Tempel URL di Langkah 2, tekan <em>Verifikasi</em> (<code className="rounded bg-white/10 px-1">action=verif</code>). Sistem menerima <code className="rounded bg-white/10 px-1">idToken</code>.</li>
              <li>6. Tekan <em>Aktifkan Premium</em> (<code className="rounded bg-white/10 px-1">action=apply</code>).</li>
              <li>7. Paket <strong>am.full.sub.annual.19q4</strong> (1 tahun) terpasang pada akun tersebut.</li>
              <li>8. Tutup penuh aplikasi Alight Motion, buka lagi, login email yang sama.</li>
            </ol>
          </div>

          <div>
            <p className="font-semibold text-white">C. Kendala umum</p>
            <ul className="mt-1.5 space-y-1 text-slate-400">
              <li>• <strong>Email tidak datang</strong> — kuota harian Google reset tiap tengah malam waktu Pasifik (siang WIB). Coba lagi nanti.</li>
              <li>• <strong>Link kedaluwarsa</strong> — link sign-in hanya berlaku singkat; ulangi Langkah 1.</li>
              <li>• <strong>idToken ditolak</strong> — pastikan URL disalin utuh termasuk bagian <code className="rounded bg-white/10 px-1">oobCode</code>.</li>
              <li>• <strong>Premium belum terlihat</strong> — tutup paksa aplikasi AM lalu buka kembali; status disinkronkan saat login.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-white">D. Catatan keamanan</p>
            <ul className="mt-1.5 space-y-1 text-slate-400">
              <li>• API key RestAPI Bimz disimpan di environment server, tidak pernah dikirim ke browser.</li>
              <li>• <code className="rounded bg-white/10 px-1">idToken</code> hanya dipakai sekali untuk aktivasi; database hanya menyimpan potongan referensi.</li>
              <li>• Semua pemanggilan <code className="rounded bg-white/10 px-1">/api/am</code> dilakukan dari server, bukan dari perangkat Anda.</li>
            </ul>
          </div>
        </div>

        {data?.upstream ? (
          <p className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-3 text-[11px] text-slate-400">
            Status upstream: {data.upstream.ok ? "aktif" : "gagal"} — {data.upstream.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}
