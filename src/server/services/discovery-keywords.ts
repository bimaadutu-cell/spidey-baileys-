/**
 * Real preset discovery keywords — Alight Motion preset content only.
 */

export const PRESET_KEYWORDS: string[] = [
  "preset alight motion",
  "alight motion preset",
  "preset xml",
  "xml alight motion",
  "preset 5mb",
  "5mb alight motion",
  "jedag jedug preset",
  "soft spoken preset",
  "velocity preset",
  "preset am",
  "preset xml am",
  "preset 5mb am",
  "alight motion xml",
  "alight motion 5mb",
  "preset alight",
  "presetalightmotion",
  "link xml preset",
  "link 5mb preset",
  "preset jj",
  "jj preset alight",
];

export const PRESET_HASHTAGS: string[] = [
  "presetalightmotion",
  "alightmotionpreset",
  "presetam",
  "presetxml",
  "preset5mb",
  "jedagjedug",
  "alightmotion",
  "alightmotionedit",
  "presetindo",
  "xmlpreset",
  "5mbpreset",
  "presetalight",
];

/** Famous Alight Motion preset creators (TikTok) — primary harvest targets. */
export const PRESET_CREATORS: string[] = [
  "arullzzxyz",
  "veyyuzumaki",
  "fajaruzumaki",
  "xnyzprst",
  "dentz_prst",
  "bimzmatcha",
  "zhon.softspoken",
  "artaknewstyle",
  "xyzprst",
  "nxyprst",
  "prstalight",
  "ampresetindo",
  "presetamstore",
  "softspokenprst",
  "velocityprst",
];

export function nextKeyword(previous?: string): string {
  const index = previous ? PRESET_KEYWORDS.indexOf(previous) : -1;
  return PRESET_KEYWORDS[(index + 1) % PRESET_KEYWORDS.length]!;
}

export function nextHashtag(previous?: string): string {
  const index = previous ? PRESET_HASHTAGS.indexOf(previous) : -1;
  return PRESET_HASHTAGS[(index + 1) % PRESET_HASHTAGS.length]!;
}
