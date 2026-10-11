"use client";

import { useMemo } from "react";
import { avatarSvg, avatarLabel, avatarSpec } from "@/lib/avatars";

export { avatarSvg, avatarLabel };

/** Full-bleed avatar with a deterministic unique look per seed key. */
export function Avatar({
  seed,
  size = 40,
  ring = true,
  className = "",
}: {
  seed: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const src = useMemo(() => avatarSvg(seed), [seed]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full object-cover ${ring ? "ring-1 ring-white/20" : ""} ${className}`}
    />
  );
}

/** Shows what makes this avatar unique (hair style, accessory, palette). */
export function AvatarMeta({ seed }: { seed: string }) {
  const spec = avatarSpec(seed);
  return (
    <p className="text-[11px] text-slate-400">
      {spec.style} · {spec.accessory === "none" ? "polos" : spec.accessory} ·{" "}
      <span className="inline-block h-2.5 w-2.5 translate-y-0.5 rounded-full align-middle" style={{ background: spec.hair }} />{" "}
      {spec.hair}
      {spec.glasses ? " · berkacamata" : ""}
      {spec.blush ? " · blush" : ""}
    </p>
  );
}
