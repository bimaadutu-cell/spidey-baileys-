"use client";

import { useEffect, useState } from "react";

/**
 * Decorative live-wallpaper frame on the home page.
 * Tries to resolve a TikTok short link into a playable mp4 via our media stack.
 */
const TIKTOK_SHARE = "https://vm.tiktok.com/ZSbcKjRcj/";

export function LiveWallpaper() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/media/resolve-tiktok?url=${encodeURIComponent(TIKTOK_SHARE)}`, {
          cache: "force-cache",
        });
        const data = (await res.json()) as { ok?: boolean; playableUrl?: string; streamUrl?: string };
        if (!cancelled && data.ok) {
          setSrc(data.streamUrl || data.playableUrl || null);
        }
      } catch {
        /* wallpaper is decorative — ignore failures */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="live-wallpaper" aria-hidden>
      <div className="live-wallpaper__frame">
        {src ? (
          <video
            src={src}
            className="live-wallpaper__video"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="live-wallpaper__fallback" />
        )}
        <div className="live-wallpaper__glow" />
      </div>
    </div>
  );
}
