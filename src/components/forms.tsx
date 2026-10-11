"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "./hooks";
import { Avatar, avatarLabel } from "./avatar";

/* ------------------------------------------------------------------ auth */

export function AuthForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">(
    params.get("mode") === "register" ? "register" : "login",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { reload } = useSession();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "register" ? { username, password, email: email || undefined } : { username, password },
        ),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Gagal");
        return;
      }
      await reload();
      router.push("/account");
    } catch {
      setError("Koneksi gagal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <div className="card-3d rounded-[26px] p-6 sm:p-8">
        <h1 className="text-2xl font-bold neon-text">{mode === "login" ? "Masuk" : "Buat Akun"}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {mode === "login"
            ? "Login untuk membuka semua preset, Global Chat, dan ulasan."
            : "Akun gratis. Password disimpan sebagai hash scrypt di server."}
        </p>

        <div className="mt-5 flex gap-2">
          <button onClick={() => setMode("login")} className="chip" data-active={mode === "login"}>
            Login
          </button>
          <button onClick={() => setMode("register")} className="chip" data-active={mode === "register"}>
            Buat Akun
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3">
          <Field label="Username">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
              maxLength={24}
              autoComplete="username"
              className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
            />
          </Field>
          {mode === "register" ? (
            <Field label="Email (opsional)">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
              />
            </Field>
          ) : null}
          <Field label="Password">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
            />
          </Field>

          {error ? <p className="text-xs text-red-300">{error}</p> : null}

          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy ? "Memproses…" : mode === "login" ? "Login" : "Buat Akun"}
          </button>
        </form>

        <p className="mt-4 text-[11px] text-slate-500">
          Dengan membuat akun, Anda setuju data username dan hash password disimpan pada database Preset Space.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/* --------------------------------------------------------------- account */

type ReviewDto = { id: string; username: string; rating: number; body: string; createdAt: string };

export function AccountPanel() {
  const { user, loading, reload } = useSession();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reviews, setReviews] = useState<ReviewDto[]>([]);
  const [stats, setStats] = useState<{ followers: number; following: number; favorites: number; uploads: number } | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadVideo, setUploadVideo] = useState("");
  const [uploadXml, setUploadXml] = useState("");
  const [uploadFive, setUploadFive] = useState("");
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // --- ALL hooks run unconditionally (Rules of Hooks) -------------------
  const username = user?.username ?? "";

  const avatarVariants = useMemo(
    () => Array.from({ length: 16 }, (_, index) => `${username}~v${index}`),
    [username],
  );

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    void (async () => {
      try {
        const res = await fetch("/api/reviews", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; items?: ReviewDto[] };
        if (!cancelled && data.ok) setReviews(data.items ?? []);
      } catch {
        if (!cancelled) setReviews([]);
      }
      try {
        const res = await fetch("/api/social", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; stats?: { followers: number; following: number; favorites: number; uploads: number } };
        if (!cancelled && data.ok && data.stats) setStats(data.stats);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const pickAvatar = useCallback(
    async (avatarKey: string) => {
      setSaving(true);
      setSaved(false);
      try {
        const res = await fetch("/api/account", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ avatarKey }),
        });
        if (res.ok) {
          await reload();
          setSaved(true);
        }
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await reload();
    router.push("/");
  }, [reload, router]);

  // --- render branches (no hooks below this line) -----------------------
  if (loading) return <div className="skeleton mx-auto h-64 max-w-md rounded-3xl" />;

  if (!user) {
    return (
      <div className="card-3d mx-auto max-w-md rounded-3xl p-8 text-center">
        <p className="text-3xl">☺</p>
        <h2 className="mt-3 text-xl font-bold">Belum login</h2>
        <p className="mt-2 text-sm text-slate-400">Login untuk mengatur avatar, favorit, dan ulasan Anda.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/login" className="btn btn-primary">Login</Link>
          <Link href="/login?mode=register" className="btn">Buat Akun</Link>
        </div>
      </div>
    );
  }

  const myReviews = reviews.filter((review) => review.username === username);
  const fiveStar = myReviews.filter((review) => review.rating === 5).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="card-3d rounded-3xl p-6">
        <div className="flex items-center gap-4">
          <Avatar seed={user.avatarKey || user.username} size={64} className="rounded-2xl" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold neon-text">{user.displayName || user.username}</h1>
            <p className="text-xs text-slate-400">@{user.username}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="chip">{user.role === "user" ? "Member" : user.role}</span>
              <span className="chip">{avatarLabel(user.avatarKey || user.username)}</span>
            </div>
            {stats ? (
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-300">
                <span><strong className="text-white">{stats.followers}</strong> followers</span>
                <span><strong className="text-white">{stats.following}</strong> following</span>
                <span><strong className="text-white">{stats.favorites}</strong> favorit</span>
                <span><strong className="text-white">{stats.uploads}</strong> upload</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Upload preset ke Preset Space</p>
          <p className="mt-1 text-[11px] text-slate-400">Isi link video + XML dan/atau 5MB. Setelah upload muncul di Discover (FYP) dengan tombol Buka XML / Buka 5MB.</p>
          <div className="mt-3 grid gap-2">
            <input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Judul preset" className="rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm outline-none" />
            <input value={uploadVideo} onChange={(e) => setUploadVideo(e.target.value)} placeholder="URL video (https://...)" className="rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm outline-none" />
            <input value={uploadXml} onChange={(e) => setUploadXml(e.target.value)} placeholder="Link XML (opsional)" className="rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm outline-none" />
            <input value={uploadFive} onChange={(e) => setUploadFive(e.target.value)} placeholder="Link 5MB / Alight share (opsional)" className="rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-sm outline-none" />
            <button
              disabled={uploading || !uploadTitle.trim() || !uploadVideo.trim()}
              className="btn btn-primary !text-xs"
              onClick={() => {
                void (async () => {
                  setUploading(true);
                  setUploadMsg(null);
                  try {
                    const res = await fetch("/api/upload", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        title: uploadTitle,
                        videoUrl: uploadVideo,
                        xmlUrl: uploadXml || undefined,
                        fiveMbUrl: uploadFive || undefined,
                      }),
                    });
                    const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
                    setUploadMsg(data.message ?? data.error ?? (data.ok ? "Berhasil" : "Gagal"));
                    if (data.ok) {
                      setUploadTitle("");
                      setUploadVideo("");
                      setUploadXml("");
                      setUploadFive("");
                      const s = await fetch("/api/social");
                      const sj = (await s.json()) as { stats?: typeof stats };
                      if (sj.stats) setStats(sj.stats);
                    }
                  } catch {
                    setUploadMsg("Koneksi gagal");
                  } finally {
                    setUploading(false);
                  }
                })();
              }}
            >
              {uploading ? "Mengupload…" : "Upload ke Preset Space"}
            </button>
            {uploadMsg ? <p className="text-xs text-slate-300">{uploadMsg}</p> : null}
          </div>
        </div>

        <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-slate-500">
          Pilih avatar — tiap varian unik untuk akun Anda
        </p>
        <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-8">
          {avatarVariants.map((key) => (
            <button
              key={key}
              onClick={() => void pickAvatar(key)}
              disabled={saving}
              title={avatarLabel(key)}
              className={`overflow-hidden rounded-xl border transition ${
                user.avatarKey === key ? "border-white" : "border-white/12 hover:border-white/40"
              }`}
              aria-label={`Avatar ${avatarLabel(key)}`}
            >
              <Avatar seed={key} size={56} ring={false} className="w-full" />
            </button>
          ))}
        </div>
        {saved ? <p className="mt-3 text-xs text-emerald-300">Avatar tersimpan.</p> : null}
        {saving ? <p className="mt-3 text-xs text-slate-400">Menyimpan…</p> : null}

        <div className="mt-6 flex gap-2">
          <Link href="/premium-alight" className="btn btn-primary !text-xs">Premium Alight</Link>
          <button onClick={() => void logout()} className="btn !text-xs">Keluar</button>
        </div>
      </div>

      <div className="card-3d rounded-3xl p-6">
        <h2 className="text-lg font-bold">Ulasan saya</h2>
        <p className="mt-1 text-xs text-slate-500">
          {fiveStar} dari 3 ulasan bintang 5 yang dibutuhkan untuk membuka Premium Alight.
        </p>
        {myReviews.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            Belum ada ulasan. Kirim ulasan dari beranda — notifikasi PNG dikirim ke WhatsApp developer.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {myReviews.map((review) => (
              <li key={review.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-white">
                  {"\u2605".repeat(review.rating)}
                  <span className="text-slate-500">{"\u2605".repeat(5 - review.rating)}</span>
                </p>
                <p className="mt-1 text-sm text-slate-300">{review.body}</p>
              </li>
            ))}
          </ul>
        )}
        <Link href="/#ulasan" className="btn mt-6 !text-xs">Tulis ulasan</Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- reviews */

export function ReviewForm() {
  const [username, setUsername] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending");
    setMessage(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, rating, body }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        imageUrl?: string;
        delivery?: { status: string; note: string };
      };
      if (!data.ok) {
        setState("error");
        setMessage(data.error ?? "Ulasan gagal dikirim");
        return;
      }
      setState("done");
      setImageUrl(data.imageUrl ?? null);
      setMessage(data.delivery?.note ?? "Ulasan tersimpan.");
      setBody("");
    } catch {
      setState("error");
      setMessage("Koneksi gagal");
    }
  };

  return (
    <form onSubmit={submit} className="card-3d rounded-3xl p-6">
      <h2 className="text-lg font-bold neon-text">Ulasan</h2>
      <p className="mt-1 text-sm text-slate-400">
        Ulasan disimpan permanen ke database, lalu notifikasi PNG dikirim ke WhatsApp developer oleh bot worker.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Nama pengguna">
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={2}
            maxLength={40}
            className="w-full rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
          />
        </Field>
        <Field label="Rating">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => setRating(value)}
                aria-label={`Rating ${value}`}
                className={`h-10 w-10 rounded-xl border text-lg transition ${
                  value <= rating ? "border-white bg-white/85 text-black" : "border-white/12 bg-white/5 text-slate-400"
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Deskripsi">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            minLength={4}
            maxLength={800}
            rows={4}
            className="w-full rounded-2xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
          />
        </Field>
      </div>

      {message ? (
        <div className="mt-3 rounded-2xl border border-white/12 bg-white/5 p-3 text-xs text-slate-300">
          <p>{message}</p>
          {state === "done" && imageUrl ? (
            <a href={imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block underline">
              Lihat gambar PNG ulasan
            </a>
          ) : null}
        </div>
      ) : null}

      <button type="submit" disabled={state === "sending"} className="btn btn-primary mt-4">
        {state === "sending" ? "Mengirim…" : "Kirim ulasan"}
      </button>
    </form>
  );
}
