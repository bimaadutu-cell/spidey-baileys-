"use client";

import { useEffect, useState } from "react";

/**
 * Splash "Selamat Datang" — tampil sekali per sesi browser.
 * - Dirender di HTML server (tidak menunggu hydration) supaya langsung terlihat.
 * - Script kecil di <head> (layout.tsx) menandai sesi yang sudah pernah melihatnya,
 *   sehingga pindah halaman / refresh tidak memunculkannya lagi.
 * - Hanya animasi opacity/transform (GPU) agar tetap mulus di 60/120Hz.
 * - Ketuk layar untuk melewati.
 */
export function WelcomeSplash() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem("ps_welcome", "1");
    } catch {
      /* storage diblokir — splash tetap hilang lewat timer */
    }
    const t = window.setTimeout(() => setGone(true), 3000);
    return () => window.clearTimeout(t);
  }, []);

  if (gone) return null;

  return (
    <div className="welcome-splash" role="status" aria-live="polite" onClick={() => setGone(true)}>
      <div className="welcome-splash__glow" aria-hidden />
      <div className="welcome-splash__badge">
        <div className="welcome-splash__mark" aria-hidden>
          预
        </div>
        <div className="welcome-splash__hello">Selamat Datang</div>
        <div className="welcome-splash__title">di Preset Space</div>
        <div className="welcome-splash__sub">Find it · Preset it · Create it</div>
        <div className="welcome-splash__bar" aria-hidden />
        <div className="welcome-splash__by">by BimzOfficial ✓</div>
      </div>
    </div>
  );
}
