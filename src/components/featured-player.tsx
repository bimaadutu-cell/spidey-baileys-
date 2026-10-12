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
  /** Degrees applied to a portrait file so it fills a landscape frame. Use -90 to keep the head at the top, 90 for the opposite direction, and 0 to disable. */
  rotation?: 0 | 90 | -90 | 180;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ratio, setRatio] = useState(16 / 9);
  const [muted, setMuted] = useState(true);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [srcFps, setSrcFps] = useState<number | null>(null);
  const [showFps, setShowFps] = useState(false);
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

  // Progress bar + fps probe run on the video's own frame callback and write to the
  // DOM directly — no React re-render while the video plays, which keeps frames even.
  useEffect(() => {
    setShowFps(new URLSearchParams(window.location.search).has("fps"));
    const video = videoRef.current;
    if (!video) return;
    type RVFC = (cb: (now: number, meta: { presentedFrames: number; mediaTime: number }) => void) => number;
    const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
    let handle = 0;
    let raf = 0;
    let alive = true;
    let lastT = 0;
    let lastFrames = 0;
    const paint = () => {
      if (barRef.current && video.duration) {
        barRef.current.style.transform = `scaleX(${video.currentTime / video.duration})`;
      }
    };
    if (rvfc) {
      const onFrame = (now: number, meta: { presentedFrames: number; mediaTime: number }) => {
        if (!alive) return;
        paint();
        if (!lastT) {
          lastT = now;
          lastFrames = meta.presentedFrames;
        } else if (now - lastT >= 1000) {
          setSrcFps(Math.round(((meta.presentedFrames - lastFrames) * 1000) / (now - lastT)));
          lastT = now;
          lastFrames = meta.presentedFrames;
        }
        handle = rvfc(onFrame);
      };
      handle = rvfc(onFrame);
    } else {
      const tick = () => {
        paint();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      (video as unknown as { cancelVideoFrameCallback?: (h: number) => void }).cancelVideoFrameCallback?.(handle);
    };
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
      className="video-smooth relative mx-auto w-full select-none overflow-hidden rounded-2xl border border-white/15 bg-black shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
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
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
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
        <div className="pointer-events-none absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/65 text-sm">
          {muted ? "🔇" : "🔊"}
        </div>
      ) : null}

      {hint && muted && !needsTap && !failed ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white/85">
          Ketuk video untuk suara
        </div>
      ) : null}

      {needsTap && !failed ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/30">
          <span className="rounded-full bg-black/75 px-4 py-2 text-xs font-semibold text-white">
            Ketuk untuk memutar
          </span>
        </div>
      ) : null}

      {showFps ? (
        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-black/75 px-2.5 py-1 font-mono text-[10px] text-white">
          video {srcFps ?? "–"} fps
        </div>
      ) : null}

      <button
        type="button"
        onClick={fullscreen}
        aria-label="Layar penuh"
        className="absolute bottom-3 right-3 z-30 grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/65 text-xs text-white"
      >
        ⛶
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[3px] bg-white/15">
        <div ref={barRef} className="h-full origin-left bg-white/85" style={{ transform: "scaleX(0)", willChange: "transform" }} />
      </div>
    </div>
  );
}
