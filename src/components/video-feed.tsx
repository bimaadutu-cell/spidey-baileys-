"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PresetGrid, ScanningPill, StatusPill, type PresetItem } from "./preset";

/**
 * Instagram-style vertical feed.
 *
 * Playback mirrors the reference site: the server resolves a *direct TikTok
 * CDN url* and 302-redirects the <video> element to it, so the browser streams
 * natively (seeking, buffering, no proxy chain). If a CDN refuses the direct
 * hit we retry once through our own byte-proxy, and only then fall back to the
 * official TikTok embed.
 *
 * While a public TikTok video is active, the client asks for a real Bimz scan.
 * Manually uploaded presets are deliberately excluded from scanning.
 */
export function VideoFeed({
  items,
  loading,
  hasMore,
  loadMore,
  locked,
  authenticated,
  error,
}: {
  items: PresetItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  locked: boolean;
  authenticated: boolean;
  error: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [scanState, setScanState] = useState<Record<string, { scanning: boolean; label: string | null; xml?: string; five?: string }>>({});
  const requested = useRef<Set<string>>(new Set());

  /* ---------------------------------------------- active item detection */
  useEffect(() => {
    const root = containerRef.current;
    if (!root || items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target instanceof HTMLElement) {
          setActiveId(visible.target.dataset.presetId ?? null);
        }
      },
      { root, threshold: [0.4, 0.7, 0.9] },
    );
    root.querySelectorAll<HTMLElement>("[data-preset-id]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items.length]);

  /* ------------------------------------- trigger a REAL scan on view */
  const triggerScan = useCallback(async (presetId: string) => {
    if (requested.current.has(presetId)) return;
    requested.current.add(presetId);
    try {
      const res = await fetch(`/api/presets/${presetId}/scan`, { method: "POST" });
      const data = (await res.json()) as { ok: boolean; scanning?: boolean; label?: string };
      if (data.scanning) {
        setScanState((prev) => ({
          ...prev,
          [presetId]: { scanning: true, label: data.label ?? "Sedang scan preset…" },
        }));
      }
    } catch {
      /* scanning is best-effort; the card keeps its stored status */
    }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const preset = items.find((item) => item.id === activeId);
    if (!preset) return;
    if (preset.discoverySource === "user_upload") return;
    // Only scan what is actually missing — never re-scan a complete preset.
    if (preset.xmlStatus === "FOUND" && preset.fiveMbStatus === "FOUND") return;
    // This starts asynchronous network work; state updates happen only after the response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void triggerScan(activeId);
  }, [activeId, items, triggerScan]);

  /* --------------------------------------- poll until the scan resolves */
  useEffect(() => {
    const pending = Object.entries(scanState).filter(([, value]) => value.scanning).map(([id]) => id);
    if (pending.length === 0) return;

    let alive = true;
    const timer = setInterval(async () => {
      for (const id of pending) {
        try {
          const res = await fetch(`/api/presets/${id}/scan`, { cache: "no-store" });
          const data = (await res.json()) as {
            ok: boolean;
            scanning: boolean;
            label: string | null;
            xmlStatus?: string;
            fiveMbStatus?: string;
          };
          if (!alive) return;
          setScanState((prev) => ({
            ...prev,
            [id]: {
              scanning: data.scanning,
              label: data.label,
              xml: data.xmlStatus,
              five: data.fiveMbStatus,
            },
          }));
        } catch {
          /* keep polling */
        }
      }
    }, 2000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scanState]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div
        ref={containerRef}
        className="no-scrollbar h-[calc(100dvh-190px)] snap-y snap-mandatory overflow-y-auto rounded-[26px] border border-white/10 bg-black/40"
      >
        {items.map((preset) => (
          <FeedItem
            key={preset.id}
            preset={preset}
            active={activeId === preset.id}
            muted={muted}
            onToggleMute={() => setMuted((prev) => !prev)}
            scan={scanState[preset.id]}
          />
        ))}

        {loading ? (
          <div className="p-6">
            <div className="skeleton aspect-[9/16] w-full rounded-2xl" />
          </div>
        ) : null}

        <div className="p-6 text-center text-xs text-slate-500">
          {hasMore ? (
            <button onClick={loadMore} className="btn">
              Muat video berikutnya
            </button>
          ) : (
            "Akhir feed — preset lain tersedia di beranda"
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card-3d rounded-3xl p-5">
          <h2 className="text-lg font-bold neon-text">Video Feed</h2>
          <p className="mt-2 text-sm text-slate-400">
            Video diputar langsung dari CDN TikTok. Saat sebuah video aktif, scanner RestAPI Bimz otomatis memeriksa
            preset video tersebut dan statusnya berubah menjadi{" "}
            <strong className="text-slate-200">Sedang scan preset…</strong> sampai hasil nyata diperoleh.
          </p>
          <ul className="mt-4 space-y-2 text-xs text-slate-400">
            <li>• Autoplay mute, satu video aktif, jeda saat keluar layar.</li>
            <li>• Gagal CDN → proxy internal → embed resmi TikTok.</li>
            <li>• Scan nyata (bukan simulasi) dengan hasil tersimpan permanen.</li>
          </ul>
        </div>

        <PresetGrid
          items={[]}
          loading={false}
          hasMore={false}
          loadMore={() => undefined}
          locked={locked}
          authenticated={authenticated}
          error={error}
        />

        <div className="card-3d rounded-3xl p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Filter cepat</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/discover?filter=xml" className="chip">XML tersedia</Link>
            <Link href="/discover?filter=five-mb" className="chip">5MB tersedia</Link>
            <Link href="/discover?sort=likes" className="chip">Paling disukai</Link>
            <Link href="/discover?sort=trending" className="chip">Trending</Link>
          </div>
        </div>
      </aside>
    </div>
  );
}

function FeedItem({
  preset,
  active,
  muted,
  onToggleMute,
  scan,
}: {
  preset: PresetItem;
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
  scan?: { scanning: boolean; label: string | null; xml?: string; five?: string };
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const base = preset.streamUrl ?? `/api/media/video/${preset.id}`;
  // 0 = direct CDN (302), 1 = our byte-proxy, 2 = official TikTok embed
  const [tier, setTier] = useState(0);
  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);

  const src = tier === 0 ? base : `${base}?proxy=1`;

  // Only the active element loads/plays — keeps memory and GPU layers bounded.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || tier > 1) return;
    if (active) {
      const play = video.play();
      if (play) void play.catch(() => undefined);
    } else {
      video.pause();
      if (video.currentTime > 0) video.currentTime = 0;
    }
  }, [active, tier]);

  // If the active video never produces data, escalate instead of hanging.
  useEffect(() => {
    if (!active || ready || tier > 1) return;
    const timer = setTimeout(() => {
      setStalled(true);
      setTier((current) => (current === 0 ? 1 : 2));
    }, 9000);
    return () => clearTimeout(timer);
  }, [active, ready, tier]);

  const xmlStatus = scan?.xml ?? preset.xmlStatus;
  const fiveStatus = scan?.five ?? preset.fiveMbStatus;
  const scanning = Boolean(scan?.scanning);

  return (
    <div data-preset-id={preset.id} className="snap-start border-b border-white/5">
      <div className="relative aspect-[9/16] w-full bg-black">
        {/* poster until the first frame is decoded */}
        {!ready && tier < 2 ? (
          <div className="absolute inset-0">
            {preset.thumbProxyUrl || preset.thumbnailUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preset.thumbProxyUrl ?? preset.thumbnailUrl ?? ""}
                alt=""
                className="h-full w-full object-cover opacity-70"
                loading="lazy"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-3xl text-white/20">预设</div>
            )}
            {active ? (
              <div className="absolute inset-0 grid place-items-center">
                <span className="rounded-full bg-black/65 px-3 py-1 text-[11px] text-slate-200 backdrop-blur">
                  {stalled ? "mencoba sumber lain…" : "memuat video…"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {tier < 2 ? (
          <video
            ref={videoRef}
            key={src}
            src={active || ready ? src : undefined}
            poster={preset.thumbProxyUrl ?? preset.thumbnailUrl ?? undefined}
            muted={muted}
            loop
            playsInline
            preload={active ? "auto" : "none"}
            className={`h-full w-full object-cover transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
            onLoadedData={() => setReady(true)}
            onCanPlay={() => setReady(true)}
            onError={() => {
              setReady(false);
              setTier((current) => (current === 0 ? 1 : 2));
            }}
          />
        ) : (
          <iframe
            src={`https://www.tiktok.com/embed/v2/${preset.tiktokId}`}
            title={preset.title ?? "TikTok"}
            allow="encrypted-media; picture-in-picture; fullscreen"
            className="h-full w-full"
            loading="lazy"
          />
        )}

        {tier < 2 ? (
          <button
            onClick={onToggleMute}
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/55 text-xs backdrop-blur"
            aria-label={muted ? "Aktifkan suara" : "Bisukan"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        ) : null}

        {/* live scan sweep */}
        {scanning ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <div className="scan-sweep h-full w-1/3 bg-white/85" />
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 pt-12">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
            {scanning ? (
              <ScanningPill label={scan?.label} />
            ) : (
              <>
                <StatusPill status={xmlStatus} />
                <StatusPill status={fiveStatus} />
              </>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold text-white">
            {preset.title ?? preset.caption ?? "Preset"}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-300">
            {preset.creator ? `@${preset.creator}` : "kreator tidak diketahui"}
            {preset.sound ? ` · ${preset.sound}` : ""}
          </p>
          <div className="pointer-events-auto mt-2 flex flex-wrap gap-2">
            <Link href={`/preset/${preset.id}`} className="btn !py-1.5 !text-[11px]">Detail preset</Link>
            {preset.xmlUrl ? (
              <a href={preset.xmlUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-primary !py-1.5 !text-[11px]">
                Ambil XML
              </a>
            ) : null}
            <a href={preset.videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="btn !py-1.5 !text-[11px]">
              TikTok ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
