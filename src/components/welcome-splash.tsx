"use client";

import { useEffect, useState } from "react";

/** Free Fire–style welcome branding on first paint of a session. */
export function WelcomeSplash() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("ps_welcome") === "1") return;
      sessionStorage.setItem("ps_welcome", "1");
      setShow(true);
      const t = window.setTimeout(() => setShow(false), 2700);
      return () => window.clearTimeout(t);
    } catch {
      setShow(true);
      const t = window.setTimeout(() => setShow(false), 2700);
      return () => window.clearTimeout(t);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="welcome-splash" aria-hidden>
      <div className="welcome-splash__badge">
        <div className="welcome-splash__mark">预</div>
        <div className="welcome-splash__title">Preset Space</div>
        <div className="welcome-splash__sub">Find it · Preset it · Create it</div>
        <div className="welcome-splash__bar" />
      </div>
    </div>
  );
}
