/**
 * Deterministic procedural avatar generator.
 * Every username maps to a genuinely different anime-style avatar — hair,
 * eyes, palette, accessory and background are all hashed from the username,
 * so no two users look alike and the same user always gets the same avatar.
 * Rendered as inline SVG data-URI: zero network requests, infinite variety.
 */

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[(seed >>> salt) % list.length]!;
}

const SKIN = ["#f6d7c4", "#efc8ae", "#e3b295", "#d69a78", "#b97e5c", "#8d5a3b", "#fde3d3", "#c98f6b"];
const HAIR = [
  "#1b1b23", "#3b2b2b", "#5a3a2a", "#8a5a3a", "#c9a06a", "#f2e2b6",
  "#e8eef7", "#9fb4d6", "#6f7fa8", "#4a3f6b", "#2f2f3d", "#b5658f",
  "#d67f7f", "#7fb5a0", "#f0a05a", "#a8b6c9",
];
const EYE = ["#2f3a4f", "#4a6fa5", "#5f8f5f", "#7a5fa5", "#a56f5f", "#3f6f7a", "#8f5f6f", "#1f2a3a"];
const BG_A = ["#0d1117", "#11131c", "#0a0f16", "#151020", "#0b1418", "#121018"];
const BG_B = ["#243044", "#3a2f4d", "#2b4a52", "#4a3550", "#1f3a4a", "#40304a"];
const GLOW = ["#ffffff", "#dfe8ff", "#cfe0ff", "#e8dcff", "#d6f0ff", "#ffe9d6"];
const STYLE = ["long", "short", "twin", "ponytail", "bob", "spiky"] as const;
const ACC = ["none", "headphones", "horn", "flower", "halo", "cat-ears", "cap", "ribbon"] as const;

export type AvatarSpec = {
  skin: string;
  hair: string;
  hair2: string;
  eye: string;
  bgA: string;
  bgB: string;
  glow: string;
  style: (typeof STYLE)[number];
  accessory: (typeof ACC)[number];
  blush: boolean;
  glasses: boolean;
  smile: number;
};

export function avatarSpec(seedKey: string): AvatarSpec {
  const seed = hash(seedKey || "anon");
  return {
    skin: pick(SKIN, seed, 2),
    hair: pick(HAIR, seed, 5),
    hair2: pick(HAIR, seed, 11),
    eye: pick(EYE, seed, 7),
    bgA: pick(BG_A, seed, 3),
    bgB: pick(BG_B, seed, 13),
    glow: pick(GLOW, seed, 17),
    style: pick(STYLE, seed, 19),
    accessory: pick(ACC, seed, 23),
    blush: ((seed >>> 29) & 1) === 1,
    glasses: ((seed >>> 31) & 1) === 1,
    smile: 2 + ((seed >>> 15) % 3),
  };
}

function hairPath(style: AvatarSpec["style"]): string {
  switch (style) {
    case "long":
      return "M16 30c-2-14 5-24 16-24s18 10 16 24c-1 8-2 16-2 22h-6c1-8 1-14 0-20-3 2-6 3-8 3s-5-1-8-3c-1 6-1 12 0 20h-6c0-6-1-14-2-22z";
    case "short":
      return "M16 30c-2-13 5-23 16-23s18 10 16 23c-1 5-2 9-2 12-1-7-4-11-14-11s-13 4-14 11c0-3-1-7-2-12z";
    case "twin":
      return "M16 30c-2-13 5-23 16-23s18 10 16 23c-1 5-2 9-2 12-1-7-4-11-14-11s-13 4-14 11c0-3-1-7-2-12zM10 26c-3 8-3 18-1 26l5-2c-2-7-2-16 0-22zM54 26c3 8 3 18 1 26l-5-2c2-7 2-16 0-22z";
    case "ponytail":
      return "M16 30c-2-13 5-23 16-23s18 10 16 23c-1 5-2 9-2 12-1-7-4-11-14-11s-13 4-14 11c0-3-1-7-2-12zM50 24c8 2 12 10 11 20-1 8-4 14-8 18l-3-4c4-4 6-10 6-16 0-7-3-13-8-16z";
    case "bob":
      return "M15 28c-1-12 6-21 17-21s18 9 17 21c0 6-1 11-2 14-1-6-3-10-15-10s-14 4-15 10c-1-3-2-8-2-14z";
    case "spiky":
      return "M16 30c-2-12 5-22 16-22 6 0 9 2 12 5l6-4-3 8 5-2-4 6c2 3 3 6 3 9-1 4-2 8-2 11-1-7-4-11-14-11s-13 4-14 11c0-3-1-7-2-11z";
  }
}

function accessoryShape(accessory: AvatarSpec["accessory"], glow: string): string {
  switch (accessory) {
    case "headphones":
      return `<path d="M12 32c0-11 9-20 20-20s20 9 20 20" stroke="${glow}" stroke-opacity="0.75" stroke-width="3" fill="none" stroke-linecap="round"/>
              <rect x="8" y="29" width="7" height="13" rx="3.5" fill="${glow}" fill-opacity="0.85"/>
              <rect x="49" y="29" width="7" height="13" rx="3.5" fill="${glow}" fill-opacity="0.85"/>`;
    case "horn":
      return `<path d="M20 14l-4-11 9 6zM44 14l4-11-9 6z" fill="${glow}" fill-opacity="0.8"/>`;
    case "flower":
      return `<g transform="translate(50,12)"><circle r="3.2" fill="${glow}" fill-opacity="0.95"/>
              <circle cx="0" cy="-5.5" r="3" fill="${glow}" fill-opacity="0.6"/><circle cx="5.2" cy="2.4" r="3" fill="${glow}" fill-opacity="0.6"/>
              <circle cx="-5.2" cy="2.4" r="3" fill="${glow}" fill-opacity="0.6"/><circle cx="3.2" cy="5.6" r="3" fill="${glow}" fill-opacity="0.6"/>
              <circle cx="-3.2" cy="5.6" r="3" fill="${glow}" fill-opacity="0.6"/></g>`;
    case "halo":
      return `<ellipse cx="32" cy="9" rx="13" ry="3.6" stroke="${glow}" stroke-opacity="0.9" stroke-width="2.6" fill="none"/>`;
    case "cat-ears":
      return `<path d="M14 22l2-13 11 7zM50 22l-2-13-11 7z" fill="${glow}" fill-opacity="0.82"/>`;
    case "cap":
      return `<path d="M14 24c0-11 8-18 18-18s18 7 18 18z" fill="${glow}" fill-opacity="0.85"/>
              <path d="M46 24h14c1 3-1 5-4 5H46z" fill="${glow}" fill-opacity="0.6"/>`;
    case "ribbon":
      return `<path d="M44 12l10-5-3 8 3 8z" fill="${glow}" fill-opacity="0.85"/><circle cx="44" cy="15" r="3.4" fill="${glow}"/>`;
    default:
      return "";
  }
}

/** Builds the avatar SVG for a seed key (username). */
export function avatarSvg(key: string): string {
  const spec = avatarSpec(key);
  const mouth =
    spec.smile === 4
      ? `<path d="M27 40q5 5 10 0" stroke="${spec.eye}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
      : spec.smile === 3
        ? `<path d="M28 40q4 3.4 8 0" stroke="${spec.eye}" stroke-width="2" fill="none" stroke-linecap="round"/>`
        : `<path d="M29 40.5q3 2 6 0" stroke="${spec.eye}" stroke-width="2" fill="none" stroke-linecap="round"/>`;

  const glasses = spec.glasses
    ? `<g stroke="${spec.glow}" stroke-opacity="0.7" stroke-width="1.6" fill="none">
         <rect x="20" y="29" width="10" height="8" rx="3"/><rect x="34" y="29" width="10" height="8" rx="3"/>
         <path d="M30 32.5h4"/></g>`
    : "";

  const blush = spec.blush
    ? `<ellipse cx="21" cy="38" rx="3.6" ry="2.2" fill="#ff9aa8" fill-opacity="0.4"/>
       <ellipse cx="43" cy="38" rx="3.6" ry="2.2" fill="#ff9aa8" fill-opacity="0.4"/>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${spec.bgB}"/><stop offset="100%" stop-color="${spec.bgA}"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="38%" r="52%">
      <stop offset="0%" stop-color="${spec.glow}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${spec.glow}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" fill="url(#bg)"/>
  <rect width="64" height="64" fill="url(#halo)"/>
  <circle cx="32" cy="32" r="30" fill="none" stroke="${spec.glow}" stroke-opacity="0.3" stroke-width="1.2"/>
  <path d="${hairPath(spec.style)}" fill="${spec.hair}" fill-opacity="0.97"/>
  <ellipse cx="32" cy="34" rx="12.5" ry="14" fill="${spec.skin}"/>
  <path d="M16 30c2-11 8-16 16-16s14 5 16 16c-3-6-8-9-16-9s-13 3-16 9z" fill="${spec.hair2}" fill-opacity="0.9"/>
  <ellipse cx="26" cy="33" rx="2.4" ry="3.1" fill="#ffffff"/>
  <ellipse cx="26.7" cy="33.3" rx="1.7" ry="2.4" fill="${spec.eye}"/>
  <ellipse cx="38" cy="33" rx="2.4" ry="3.1" fill="#ffffff"/>
  <ellipse cx="37.3" cy="33.3" rx="1.7" ry="2.4" fill="${spec.eye}"/>
  <path d="M23 28.4q3-2.2 6 0M35 28.4q3-2.2 6 0" stroke="${spec.hair}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-opacity="0.75"/>
  ${blush}
  ${mouth}
  ${glasses}
  ${accessoryShape(spec.accessory, spec.glow)}
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** A short human-readable descriptor, shown next to the avatar in /account. */
export function avatarLabel(key: string): string {
  const spec = avatarSpec(key);
  const accName: Record<AvatarSpec["accessory"], string> = {
    none: "polos",
    headphones: "headphone",
    horn: "tanduk",
    flower: "bunga",
    halo: "halo",
    "cat-ears": "telinga kucing",
    cap: "topi",
    ribbon: "pita",
  };
  return `${spec.style} · ${accName[spec.accessory]}`;
}

/** Generates a distinct avatar key for a new user. */
export function generateAvatarKey(username: string): string {
  const spec = avatarSpec(username);
  return `${spec.style}-${spec.accessory}-${hash(username) % 9973}`;
}
