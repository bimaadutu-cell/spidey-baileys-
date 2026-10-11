"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PresetGrid, PresetSkeletonGrid, type PresetItem } from "./preset";
import { ReviewForm } from "./forms";
import { usePagedQuery, useDebounced, useLocalFavorites, useSession, useActiveScans } from "./hooks";

export type CategoryDto = { slug: string; label: string; labelCn: string | null; count: number };

const FILTERS = [
  { value: "", label: "Semua" },
  { value: "trending", label: "Trending", sort: "trending" },
  { value: "latest", label: "Terbaru", sort: "latest" },
  { value: "old", label: "Old" },
  { value: "xml", label: "XML" },
  { value: "five-mb", label: "5MB" },
  { value: "complete", label: "XML + 5MB" },
  { value: "pending", label: "Belum lengkap" },
];

const SORTS = [
  { value: "latest", label: "Terbaru" },
  { value: "trending", label: "Trending" },
  { value: "likes", label: "Paling banyak like" },
  { value: "comments", label: "Paling banyak komentar" },
  { value: "oldest", label: "Old but Gold" },
  { value: "confidence", label: "Confidence tertinggi" },
];

const QUICK_KEYWORDS = [
  "preset alight motion",
  "xml preset",
  "5mb preset",
  "jedag jedug",
  "soft spoken",
  "velocity",
  "anime edit",
  "cinematic",
  "sad edit",
];

export function HomeView({ initialQuery, favoritesOnly }: { initialQuery: string; favoritesOnly: boolean }) {
  const [term, setTerm] = useState(initialQuery);
  const debounced = useDebounced(term, 350);
  const [filter, setFilter] = useState("complete");
  const [sort, setSort] = useState("confidence");
  const [category, setCategory] = useState("all");
  const [creator, setCreator] = useState("");
  const [scanKeyword, setScanKeyword] = useState("preset alight motion");
  const [scanState, setScanState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const [ingestUrlValue, setIngestUrlValue] = useState("");
  const [ingestState, setIngestState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const { user } = useSession();
  const { favorites } = useLocalFavorites();
  const { scanningIds, scanningCount } = useActiveScans();

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (favoritesOnly) params.set("mode", "favorites");
    const source = favoritesOnly ? "" : debounced;
    if (source) params.set("q", source);
    if (filter) params.set("filter", filter);
    if (sort) params.set("sort", sort);
    if (category !== "all") params.set("category", category);
    if (creator.trim()) params.set("creator", creator.trim().replace(/^@/, ""));
    params.set("limit", "12");
    const base = favoritesOnly ? `/api/presets?ids=${encodeURIComponent(favorites.join(","))}` : `/api/presets?${params}`;
    return base;
  }, [category, creator, debounced, filter, favoritesOnly, favorites, sort]);

  const { items, total, hasMore, loading, error, locked, loadMore } = usePagedQuery<PresetItem>(endpoint, true);

  const categories = usePagedQuery<CategoryDto & { id: string }>(
    "/api/categories",
    true,
  );

  const ingestUrl = async (event: React.FormEvent) => {
    event.preventDefault();
    setIngestState({ busy: true, message: null });
    try {
      const res = await fetch("/api/scan?mode=ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: ingestUrlValue.trim(), scan: true }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
        presetId?: string | null;
      };
      setIngestState({
        busy: false,
        message: data.ok
          ? `${data.message ?? "Preset tersimpan"} — lihat detail untuk status XML/5MB.`
          : data.error ?? "Ingest gagal",
      });
      if (data.ok && data.presetId) {
        setIngestUrlValue("");
        window.location.href = `/preset/${data.presetId}`;
      }
    } catch {
      setIngestState({ busy: false, message: "Koneksi gagal" });
    }
  };

  const runScan = async () => {
    setScanState({ busy: true, message: null });
    try {
      const res = await fetch("/api/scan?mode=keyword", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: scanKeyword, count: 12 }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        report?: { found: number; ingested: number; duplicates: number; providers: { provider: string; ok: boolean; message: string }[] };
      };
      if (!data.ok) {
        setScanState({ busy: false, message: data.error ?? "Scan gagal" });
        return;
      }
      const report = data.report!;
      const failures = report.providers.filter((p) => !p.ok).map((p) => `${p.provider}: ${p.message}`);
      setScanState({
        busy: false,
        message: `Ditemukan ${report.found} video · baru ${report.ingested} · duplikat ${report.duplicates}. ${
          failures.length ? `Provider gagal → ${failures.join(" | ")}` : ""
        }`,
      });
      loadMore();
      window.location.reload();
    } catch {
      setScanState({ busy: false, message: "Koneksi gagal" });
    }
  };

  return (
    <div className="space-y-10">
      {/* ------------------------------------------- premium calling banner */}
      <Link
        href="/premium-alight"
        className="card-3d card-3d-hover group flex items-center gap-4 rounded-[24px] p-4 sm:p-5"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-white to-slate-300 text-xl text-black">
          ✦
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="chip animate-pulse">PremiumAlight</span>
            <span className="live-dot" />
          </span>
          <span className="mt-1.5 block text-sm font-semibold text-white sm:text-base">
            Ingin gunakan preset tapi AM belum premium? Ayo gunakan aku
          </span>
          <span className="mt-0.5 block text-[11px] text-slate-400">
            Aktifkan Alight Motion Premium 1 tahun — terbuka setelah 3 ulasan bintang 5.
          </span>
        </span>
        <span className="shrink-0 text-slate-400 transition group-hover:translate-x-1">→</span>
      </Link>

      {/* ---------------------------------------------------------- hero */}
      <section className="card-3d relative overflow-hidden rounded-[30px] p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <span className="chip">预设空间 · PRESET SPACE</span>
        <h1 className="mt-4 max-w-3xl text-3xl font-black leading-tight neon-text sm:text-5xl">
          Welcome to <span className="text-amber-300">Preset Space</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
          Preset Space menemukan preset Alight Motion dari konten publik TikTok, memindai caption &amp; komentar,
          mendeteksi link <strong className="text-slate-200">XML</strong> dan{" "}
          <strong className="text-slate-200">5MB</strong>, lalu menyimpannya permanen di PostgreSQL. Hasil yang belum
          terverifikasi ditampilkan jujur sebagai &ldquo;belum ditemukan&rdquo;, bukan dibuat-buat.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/discover" className="btn btn-primary">
            ▶ Buka video feed
          </Link>
          <a href="#scanner" className="btn">
            ⚡ Jalankan scanner
          </a>
          <Link href="/?favorites=1" className="chip" data-active={favoritesOnly}>
            ★ Favorites{favorites.length ? ` (${favorites.length})` : ""}
          </Link>
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Preset tersimpan", value: total },
            { label: "Kategori", value: categories.items.length },
            { label: "Login", value: user ? "Aktif" : "Anonim (10 preset)" },
            { label: "Sumber", value: "TikTok publik" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/4 p-3">
              <dt className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{stat.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-white">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------- filters */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Cari caption, kreator, atau sound preset…"
            className="flex-1 rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm outline-none transition focus:border-white/35"
          />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="rounded-2xl border border-white/12 bg-[#0b0b11] px-3 py-3 text-sm text-slate-200 outline-none"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value || "all"}
              onClick={() => {
                setFilter(option.value);
                if (option.sort) setSort(option.sort);
              }}
              className="chip"
              data-active={filter === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCategory("all")} className="chip" data-active={category === "all"}>
            Semua kategori
          </button>
          {categories.items.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.slug)}
              className="chip"
              data-active={category === cat.slug}
              title={cat.labelCn ?? cat.label}
            >
              {cat.label} · {cat.count}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={creator}
            onChange={(event) => setCreator(event.target.value)}
            placeholder="@kreator"
            className="w-40 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-xs outline-none focus:border-white/35"
          />
          <span className="text-[11px] text-slate-500">
            {items.length} dari {total} preset ditampilkan
          </span>
        </div>
      </section>

      {/* -------------------------------------------------------- presets */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold neon-text">
            {favoritesOnly ? "★ Favorites" : filter === "xml" ? "XML Available" : filter === "five-mb" ? "5MB Available" : "Preset"}
          </h2>
          <span className="flex items-center gap-2 text-[11px] text-slate-500">
            {scanningCount > 0 ? (
              <span className="chip !border-white/40 !bg-white/15 !text-white">
                <span className="live-dot" /> {scanningCount} preset sedang di-scan
              </span>
            ) : null}
            {user ? "Akses penuh" : "Anonim dibatasi 10 preset (server-side)"}
          </span>
        </div>

        {loading && items.length === 0 ? (
          <PresetSkeletonGrid />
        ) : (
          <PresetGrid
            items={items}
            loading={loading}
            hasMore={hasMore}
            loadMore={loadMore}
            locked={locked}
            authenticated={Boolean(user)}
            error={error}
            scanningIds={scanningIds}
          />
        )}
      </section>

      {/* ------------------------------------------------------- scanner */}
      <section id="scanner" className="card-3d rounded-3xl p-6">
        <h2 className="text-lg font-bold neon-text">Deep Preset Scanner</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Scanner menjalankan Tahap A–E: metadata video → analisis caption → analisis komentar (bila provider
          menyediakan) → pencarian ulang relevan + resolver Bimz → validasi URL. Setiap tahap dicatat di tabel
          <code className="mx-1 rounded bg-white/10 px-1">scan_attempts</code> dan dapat diperiksa di{" "}
          <Link href="/admin" className="underline">
            /admin
          </Link>
          .
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_KEYWORDS.map((keyword) => (
            <button key={keyword} onClick={() => setScanKeyword(keyword)} className="chip" data-active={scanKeyword === keyword}>
              {keyword}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={scanKeyword}
            onChange={(event) => setScanKeyword(event.target.value)}
            className="min-w-56 flex-1 rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/35"
          />
          <button onClick={() => void runScan()} disabled={scanState.busy} className="btn btn-primary">
            {scanState.busy ? "Memindai…" : "Cari & scan preset"}
          </button>
        </div>

        <form
          onSubmit={(event) => void ingestUrl(event)}
          className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-4"
        >
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
            Tambah preset dari URL TikTok
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Metadata resmi (oEmbed) + metadata provider dibaca langsung, lalu deep scanner Tahap A–E dijalankan atas
            video tersebut. Ini jalur pencarian yang selalu tersedia.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={ingestUrlValue}
              onChange={(event) => setIngestUrlValue(event.target.value)}
              placeholder="https://www.tiktok.com/@kreator/video/1234567890"
              className="min-w-56 flex-1 rounded-xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm outline-none focus:border-white/35"
            />
            <button type="submit" disabled={ingestState.busy || ingestUrlValue.trim().length < 10} className="btn">
              {ingestState.busy ? "Memproses…" : "Ingest & scan"}
            </button>
          </div>
          {ingestState.message ? (
            <p className="mt-3 break-words text-xs text-slate-300">{ingestState.message}</p>
          ) : null}
        </form>

        {scanState.message ? (
          <p className="mt-3 rounded-2xl border border-white/12 bg-white/5 p-3 text-xs text-slate-300">{scanState.message}</p>
        ) : null}
      </section>

      {/* -------------------------------------------------------- review */}
      <section id="ulasan" className="grid gap-4 lg:grid-cols-2">
        <ReviewForm />
        <div className="card-3d rounded-3xl p-6">
          <h2 className="text-lg font-bold neon-text">Integrasi WhatsApp</h2>
          <p className="mt-2 text-sm text-slate-400">
            Ulasan disimpan lebih dulu ke PostgreSQL, kemudian dimasukkan ke antrean{" "}
            <code className="rounded bg-white/10 px-1">whatsapp_delivery_logs</code>. Worker SPACEPRS (Baileys) mengirim
            gambar PNG ulasan ke nomor developer. Jika bot offline, ulasan tetap tersimpan dan akan dicoba ulang.
          </p>
          <ul className="mt-4 space-y-1.5 text-xs text-slate-500">
            <li>• Status pengiriman: queued → pending → sent / failed</li>
            <li>• Idempotensi memakai review ID sehingga retry tidak mengirim dua kali</li>
            <li>• Gambar dirender server-side (sharp), bukan teks yang dianggap gambar</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
