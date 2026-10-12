"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Clean video player — no native controls, no rotation hacks.
 * - Orientation is read from the video itself (videoWidth/Height), so portrait
 *   and landscape files both show upright; browsers already honour the
 *   file's rotation metadata.
 * - Autoplays muted + loops; tap anywhere to toggle sound, long-press-free.
 * - Pauses off-screen, thin progress bar, fullscreen button.
 */
export function FeaturedPlayer({
  src,
  title,
  rotation = -90,
}: {
  src: string;
  title?: string;
  /** Degrees applied to a portrait file so it fills a landscape frame. -90 = kepala di atas. Use 90 to flip, 0 to disable. */
  rotation?: 0 | 90 | -90 | 180;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ratio, setRatio] = useState(16 / 9);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [hint, setHint] = useState(true);

  const tryPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setNeedsTap(false);
    } catch {
      setNeedsTap(true);
    }
  }, []);

  // autoplay only while visible
  useEffect(() => {
    const el = wrapRef.current;
    const video = videoRef.current;
    if (!el || !video) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void tryPlay();
        else video.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tryPlay]);

  const onTap = async () => {
    const video = videoRef.current;
    if (!video) return;
    setHint(false);
    if (video.paused) {
      await tryPlay();
      return;
    }
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  // A portrait file shown in a 16:9 frame, turned sideways so it fills the frame.
  const fillLandscape = rotation !== 0 && rotation !== 180 && ratio < 1;

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto w-full select-none overflow-hidden rounded-2xl border border-white/15 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      style={
        fillLandscape
          ? { aspectRatio: "16 / 9" }
          : { aspectRatio: String(ratio), maxHeight: "72dvh", maxWidth: ratio < 1 ? `calc(72dvh * ${ratio})` : "100%" }
      }
    >
      {failed ? (
        <div className="grid h-full w-full place-items-center p-6 text-center text-xs text-slate-400">
          Video tidak bisa dimuat.
        </div>
      ) : (
        <video
          ref={videoRef}
          src={src}
          title={title}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className={
            fillLandscape
              ? "absolute left-1/2 top-1/2 max-w-none object-contain"
              : "h-full w-full object-contain"
          }
          style={
            fillLandscape
              ? {
                  width: "56.25%",
                  height: "177.7778%",
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                }
              : rotation === 180
                ? { transform: "rotate(180deg)" }
                : undefined
          }
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration) setProgress(v.currentTime / v.duration);
          }}
          onError={() => setFailed(true)}
        />
      )}

      {/* tap layer */}
      {!failed ? (
        <button
          type="button"
          onClick={() => void onTap()}
          aria-label={muted ? "Nyalakan suara" : "Matikan suara"}
          className="absolute inset-0 z-10 cursor-pointer bg-transparent"
        />
      ) : null}

      {/* sound state — small icon only, no big play button */}
      {!failed ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/50 text-sm backdrop-blur">
          {muted ? "🔇" : "🔊"}
        </div>
      ) : null}

      {hint && muted && !needsTap && !failed ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/85 backdrop-blur">
          Ketuk video untuk suara
        </div>
      ) : null}

      {needsTap && !failed ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/30">
          <span className="rounded-full bg-black/65 px-4 py-2 text-xs font-semibold text-white backdrop-blur">
            Ketuk untuk memutar
          </span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={fullscreen}
        aria-label="Layar penuh"
        className="absolute bottom-3 right-3 z-30 grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/50 text-xs text-white backdrop-blur"
      >
        ⛶
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[3px] bg-white/15">
        <div className="h-full bg-white/85" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
