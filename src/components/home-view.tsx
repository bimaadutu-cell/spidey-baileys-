"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PresetGrid, PresetSkeletonGrid, type PresetItem } from "./preset";
import { FeaturedPlayer } from "./featured-player";
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
];

const SORTS = [
  { value: "latest", label: "Terbaru" },
  { value: "trending", label: "Trending" },
  { value: "likes", label: "Paling banyak like" },
  { value: "comments", label: "Paling banyak komentar" },
  { value: "oldest", label: "Old but Gold" },
  { value: "confidence", label: "Confidence tertinggi" },
];

export function HomeView({ initialQuery, favoritesOnly }: { initialQuery: string; favoritesOnly: boolean }) {
  const [term, setTerm] = useState(initialQuery);
  const debounced = useDebounced(term, 350);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("latest");
  const [category, setCategory] = useState("all");
  const [creator, setCreator] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [newCount, setNewCount] = useState(0);
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
    if (refreshKey) params.set("r", String(refreshKey));
    return favoritesOnly ? `/api/presets?ids=${encodeURIComponent(favorites.join(","))}&r=${refreshKey}` : `/api/presets?${params}`;
  }, [category, creator, debounced, filter, favoritesOnly, favorites, sort, refreshKey]);

  const { items, total, hasMore, loading, error, locked, loadMore } = usePagedQuery<PresetItem>(endpoint, true);
  const categories = usePagedQuery<CategoryDto & { id: string }>("/api/categories", true);

  // Auto-update: the server keeps researching in the background; here we just
  // watch the global total and pull new presets in as soon as they land.
  const baseline = useRef<number | null>(null);
  useEffect(() => {
    if (favoritesOnly) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/presets?limit=1&sort=latest&page=1", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; total?: number };
        if (!alive || !data.ok || typeof data.total !== "number") return;
        if (baseline.current === null) {
          baseline.current = data.total;
          return;
        }
        const diff = data.total - baseline.current;
        if (diff > 0) {
          if (window.scrollY < 240) {
            baseline.current = data.total;
            setNewCount(0);
            setRefreshKey((k) => k + 1);
          } else {
            setNewCount(diff);
          }
        }
      } catch {
        /* keep polling */
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 10000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [favoritesOnly]);

  const applyNew = () => {
    baseline.current = null;
    setNewCount(0);
    setRefreshKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------ selamat datang */}
      <section className="card-3d rounded-[28px] p-5 sm:p-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Preset Space</p>
        <h1 className="mt-1 text-2xl font-black leading-tight neon-text sm:text-3xl">
          Selamat datang{user ? `, ${user.displayName}` : ""}! 👋
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Di sini hanya tampil preset yang <strong className="text-white">sudah ditemukan</strong> (XML / 5MB siap dibuka).
          Bimz terus mencari sisanya di latar belakang — begitu ketemu, preset langsung muncul di beranda secara otomatis.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="chip !border-white/30 !bg-white/10 !text-white">{total} preset ditemukan</span>
          <span className="flex items-center gap-1.5">
            <span className="live-dot" /> Bimz scan otomatis aktif
          </span>
        </div>
      </section>

      {/* ------------------------------------------------ featured video */}
      <section className="card-3d rounded-[28px] p-3 sm:p-5">
        <FeaturedPlayer src="https://files.catbox.moe/kq2a4q.mp4" title="Video unggulan" />
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
            {items.length} dari {total} preset ditemukan
          </span>
        </div>
      </section>

      {/* ------------------------------------- new presets (auto research) */}
      {newCount > 0 ? (
        <button
          onClick={applyNew}
          className="btn btn-primary fixed left-1/2 top-20 z-40 -translate-x-1/2 shadow-xl"
        >
          ↑ {newCount} preset baru ditemukan — ketuk untuk lihat
        </button>
      ) : null}

      {/* -------------------------------------------------------- presets */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold neon-text">
            {favoritesOnly ? "★ Favorites" : filter === "xml" ? "XML Available" : filter === "five-mb" ? "5MB Available" : "Semua Preset"}
          </h2>
          <span className="flex items-center gap-2 text-[11px] text-slate-500">
            {scanningCount > 0 ? (
              <span className="chip !border-white/40 !bg-white/15 !text-white">
                <span className="live-dot" /> Bimz sedang mencari {scanningCount} preset lagi
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="live-dot" /> Bimz terus mencari preset baru
              </span>
            )}
            {user ? null : "Anonim dibatasi (server-side)"}
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
    </div>
  );
}
