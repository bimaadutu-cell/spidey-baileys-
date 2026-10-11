"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocalFavorites } from "./hooks";

export type PresetItem = {
  id: string;
  tiktokId: string;
  title: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  playableUrl: string | null;
  playableExpiresAt: string | null;
  embedUrl: string | null;
  videoUrl: string;
  streamUrl?: string;
  thumbProxyUrl?: string;
  scanning?: boolean;
  scanLabel?: string | null;
  durationSec: number | null;
  creator: string | null;
  creatorName: string | null;
  sound: string | null;
  categoryLabel: string | null;
  categorySlug: string | null;
  xmlStatus: string;
  fiveMbStatus: string;
  overallStatus: string;
  confidence: number;
  xmlUrl: string | null;
  fiveMbUrl: string | null;
  likes: number | null;
  viewCount?: number | null;
  favoriteCount?: number | null;
  comments: number | null;
  publishedAt: string | null;
  lastScannedAt: string | null;
  hashtags: string[];
};

export const STATUS_LABEL: Record<string, string> = {
  NEW: "Belum dipindai",
  SCANNING: "Sedang scan preset…",
  PARTIAL: "Sebagian ditemukan",
  XML_FOUND: "XML ditemukan",
  FIVE_MB_FOUND: "5MB ditemukan",
  COMPLETE: "XML + 5MB lengkap",
  RETRY_PENDING: "Menunggu scan ulang",
  SOURCE_UNAVAILABLE: "Sumber tidak tersedia",
  FAILED: "Gagal",
  FOUND: "Ditemukan",
  PENDING: "Belum ditemukan",
  COMMENTS_UNAVAILABLE: "Komentar tidak tersedia",
};

/** Pulsing pill shown while a scan is actually running. */
export function ScanningPill({ label }: { label?: string | null }) {
  return (
    <span className="chip !border-white/40 !bg-white/15 !text-white">
      <span className="live-dot" />
      {label ?? "Sedang scan preset…"}
    </span>
  );
}

export function StatusPill({ status, tone = "auto" }: { status: string; tone?: "auto" | "muted" }) {
  if (status === "SCANNING") return <ScanningPill />;
  const positive = status === "FOUND" || status === "COMPLETE" || status === "XML_FOUND" || status === "FIVE_MB_FOUND";
  const warn = status === "PENDING" || status === "RETRY_PENDING" || status === "PARTIAL" || status === "SCANNING" || status === "NEW";
  const color = tone === "muted" ? "text-slate-300" : positive ? "text-white" : warn ? "text-slate-300" : "text-slate-400";
  return (
    <span className={`chip ${color}`} title={STATUS_LABEL[status] ?? status}>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: positive ? "#ffffff" : warn ? "#9aa3b2" : "#5d6473" }}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function formatCount(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function PresetCard({ preset, compact = false }: { preset: PresetItem; compact?: boolean }) {
  const { favorites, toggle } = useLocalFavorites();
  const [mediaFailed, setMediaFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isFavorite = favorites.includes(preset.id);

  const stream = preset.streamUrl ?? `/api/media/video/${preset.id}`;

  const togglePlay = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      // User gesture → allow sound (browsers block autoplay-with-audio otherwise)
      el.muted = false;
      el.volume = 1;
      void el.play().then(() => setPlaying(true)).catch(() => {
        // Fallback: try muted then unmute
        el.muted = true;
        void el.play().then(() => {
          el.muted = false;
          setPlaying(true);
        }).catch(() => setMediaFailed(true));
      });
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <article className="card-3d card-3d-hover group relative overflow-hidden rounded-[22px]">
      <div className="block">
        <div className="relative aspect-[9/13] w-full overflow-hidden bg-gradient-to-br from-white/8 via-white/3 to-black">
          {!mediaFailed ? (
            <video
              ref={videoRef}
              src={stream}
              poster={preset.thumbProxyUrl ?? preset.thumbnailUrl ?? undefined}
              loop
              playsInline
              preload="metadata"
              controls={playing}
              className="h-full w-full object-cover"
              onError={() => setMediaFailed(true)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={togglePlay}
            />
          ) : preset.thumbProxyUrl || preset.thumbnailUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={preset.thumbProxyUrl ?? preset.thumbnailUrl ?? ""}
              alt={preset.title ?? "Preset TikTok"}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl text-white/25">预设</div>
          )}

          {/* Play / Pause control */}
          {!mediaFailed ? (
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={togglePlay}
              className="absolute left-1/2 top-1/2 z-10 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-black/55 text-xl text-white shadow-lg backdrop-blur-sm transition hover:scale-105"
              style={{ opacity: playing ? 0 : 1 }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.opacity = playing ? "0" : "1";
              }}
            >
              {playing ? "❚❚" : "▶"}
            </button>
          ) : null}

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

          <div className="absolute inset-x-3 top-3 flex flex-wrap gap-1.5">
            {preset.scanning ? (
              <ScanningPill label={preset.scanLabel} />
            ) : (
              <>
                <StatusPill status={preset.xmlStatus === "FOUND" ? "FOUND" : preset.xmlStatus} />
                <StatusPill status={preset.fiveMbStatus === "FOUND" ? "FOUND" : preset.fiveMbStatus} />
              </>
            )}
          </div>

          {preset.scanning ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
              <div className="scan-sweep h-full w-1/3 bg-white/80" />
            </div>
          ) : null}

          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              toggle(preset.id);
            }}
            aria-label="Simpan ke favorit"
            className="absolute right-3 bottom-3 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/45 text-sm backdrop-blur transition hover:bg-black/70"
          >
            {isFavorite ? "★" : "☆"}
          </button>

          <div className="absolute inset-x-3 bottom-3 space-y-1">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-white drop-shadow">
              {preset.title ?? preset.caption ?? "Preset Alight Motion"}
            </p>
            <p className="text-[11px] text-slate-300">
              {preset.creator ? `@${preset.creator}` : "kreator tidak diketahui"}
              {preset.likes !== null ? ` · ♥ ${formatCount(preset.likes)}` : ""}
            </p>
          </div>
        </div>
        <Link href={`/preset/${preset.id}`} className="absolute inset-x-0 bottom-0 top-[55%] z-[1]" aria-label="Detail preset" />
      </div>

      {!compact ? (
        <div className="space-y-2 px-3.5 pb-3.5 pt-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            {preset.categoryLabel ? <span className="chip">{preset.categoryLabel}</span> : null}
            <span className="chip">Confidence {preset.confidence}%</span>
            {preset.playableUrl ? <span className="chip">Video siap</span> : <span className="chip">Embed TikTok</span>}
          </div>
          <div className="flex gap-2">
            <p className="mt-1 text-[11px] text-slate-400">
              👁 {formatCount(preset.viewCount ?? 0)} tontonan
              {(preset.favoriteCount ?? 0) > 0 ? ` · ♥ ${formatCount(preset.favoriteCount ?? 0)}` : ""}
            </p>
            {preset.xmlUrl ? (
              <a
                href={`/api/preset/${preset.id}/xml`}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn-xml"
                title="XML + suara otomatis untuk Alight Motion"
              >
                ⬇ Buka XML + Suara
              </a>
            ) : (
              <span className="btn flex-1 !py-1.5 !text-[11px] !text-slate-400">XML —</span>
            )}
            {preset.fiveMbUrl ? (
              <a href={preset.fiveMbUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn-5mb">
                ⬇ Buka 5MB
              </a>
            ) : (
              <span className="btn flex-1 !py-1.5 !text-[11px] !text-slate-400">5MB —</span>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function PresetSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-[22px] border border-white/10">
          <div className="skeleton aspect-[9/13] w-full" />
          <div className="space-y-2 p-3">
            <div className="skeleton h-3 w-3/4 rounded-full" />
            <div className="skeleton h-3 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Infinite scroll sentinel + login gate card (server enforces the 10 preset cap). */
export function PresetGrid({
  items,
  loading,
  hasMore,
  loadMore,
  locked,
  authenticated,
  error,
  scanningIds,
}: {
  scanningIds?: Record<string, string>;
  items: PresetItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  locked: boolean;
  authenticated: boolean;
  error: string | null;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || locked) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, locked]);

  if (error && items.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 text-sm text-slate-300">
        <p className="font-semibold text-white">Data tidak dapat dimuat</p>
        <p className="mt-1 text-slate-400">{error}</p>
        <p className="mt-2 text-xs text-slate-500">
          Periksa koneksi database (DATABASE_URL) pada /api/health.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map((preset) => {
          const liveLabel = scanningIds?.[preset.id];
          return (
            <PresetCard
              key={preset.id}
              preset={
                liveLabel
                  ? { ...preset, scanning: true, scanLabel: liveLabel, overallStatus: "SCANNING" }
                  : preset
              }
            />
          );
        })}
      </div>

      {locked || (!authenticated && items.length >= 10 && !hasMore) ? (
        <div className="card-3d animate-float-in mt-6 overflow-hidden rounded-[26px] p-8 text-center">
          <p className="text-2xl">🔒</p>
          <h3 className="mt-3 text-xl font-bold neon-text">Login untuk membuka semua preset.</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Pengunjung anonim dibatasi 10 preset oleh server. Setelah login, seluruh preset yang tersedia di database
            dapat dijelajahi.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/login" className="btn btn-primary">
              Login
            </Link>
            <Link href="/login?mode=register" className="btn">
              Buat Akun
            </Link>
          </div>
        </div>
      ) : null}

      <div ref={sentinel} className="h-6" />
      {loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
          <span className="live-dot" /> Memuat preset…
        </div>
      ) : null}
      {!hasMore && items.length > 0 && !locked ? (
        <p className="mt-6 text-center text-xs text-slate-500">
          Semua preset yang tersedia di database sudah ditampilkan.
        </p>
      ) : null}
    </>
  );
}
