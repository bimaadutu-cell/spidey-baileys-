"use client";

import { useEffect, useState } from "react";

/**
 * High-refresh runtime tuner (targets 120Hz+ without jank).
 *
 * What actually causes "patah-patah" is not the animation count but main-thread
 * work landing inside a frame budget of 8.33ms (120Hz). This component:
 *
 *  1. Measures the true refresh rate from frame deltas (median, not average,
 *     so a single hitch cannot skew it).
 *  2. Publishes it as `--hz` / `--frame-ms` / `data-hz` for CSS.
 *  3. Watches long tasks + dropped frames and degrades decoration before the
 *     user can perceive stutter.
 *  4. Disables heavy effects while scrolling, then restores them after.
 */
export function PerfTuner() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    let last = performance.now();
    const deltas: number[] = [];
    let measured = false;
    let dropped = 0;
    let checked = 0;

    const apply = (hz: number) => {
      root.dataset.hz = String(hz);
      root.style.setProperty("--hz", String(hz));
      root.style.setProperty("--frame-ms", `${(1000 / hz).toFixed(2)}ms`);
    };

    const loop = (now: number) => {
      const delta = now - last;
      last = now;

      if (delta > 0 && delta < 100) {
        if (!measured) {
          deltas.push(delta);
          if (deltas.length >= 40) {
            // Median delta → stable refresh estimate.
            const sorted = [...deltas].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)]!;
            const hz =
              median < 5.5 ? 240 : median < 7.6 ? 144 : median < 9.6 ? 120 : median < 13 ? 90 : 60;
            apply(hz);
            measured = true;
          }
        } else {
          // Budget = 1.6 frames. Beyond that the user sees a hitch.
          const budget = Number(root.style.getPropertyValue("--frame-ms") || 8.33) * 1.6;
          checked += 1;
          if (delta > budget) dropped += 1;

          if (checked >= 120) {
            const ratio = dropped / checked;
            if (ratio > 0.25) root.dataset.perf = "lite";
            else if (ratio < 0.06 && root.dataset.perf === "lite") delete root.dataset.perf;
            dropped = 0;
            checked = 0;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    apply(120); // optimistic default until measured

    // Long tasks (>50ms) are the real jank source — react immediately.
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        if (list.getEntries().some((entry) => entry.duration > 120)) {
          root.dataset.perf = "lite";
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask unsupported — frame sampling above still covers it */
    }

    // Shed effects during scroll, restore shortly after it stops.
    let scrollTimer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      root.dataset.scrolling = "1";
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => delete root.dataset.scrolling, 160);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const onVisibility = () => {
      root.dataset.hidden = document.hidden ? "1" : "0";
    };
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(scrollTimer);
    };
  }, []);

  return null;
}

/** On-screen FPS read-out, enabled with ?fps=1 */
export function FpsMeter() {
  const [fps, setFps] = useState<number | null>(null);
  const [hz, setHz] = useState<string>("—");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("fps")) return;
    setShow(true);
    let raf = 0;
    let frames = 0;
    let start = performance.now();
    const loop = (now: number) => {
      frames += 1;
      if (now - start >= 500) {
        setFps(Math.round((frames * 1000) / (now - start)));
        setHz(document.documentElement.dataset.hz ?? "—");
        frames = 0;
        start = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!show) return null;
  return (
    <div className="fixed left-3 top-20 z-[60] rounded-full border border-white/20 bg-black/75 px-3 py-1 font-mono text-[11px] text-white backdrop-blur">
      {fps ?? "–"} fps · {hz}Hz
    </div>
  );
}
