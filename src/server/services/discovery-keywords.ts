/**
 * Real preset discovery keywords — these are the actual Alight Motion
 * preset hashtags/keywords used on TikTok, not generic guesses.
 * The Bimz preset index matches on these; unused ones simply return 0 rows.
 */

export const PRESET_KEYWORDS: string[] = [
  "preset",
  "preset alight motion",
  "alight motion preset",
  "preset xml",
  "xml alight motion",
  "link xml",
  "preset 5mb",
  "5mb alight motion",
  "5 mb preset",
  "jedag jedug",
  "jedag jedug preset",
  "soft spoken",
  "soft spoken preset",
  "velocity",
  "velocity preset",
  "shake preset",
  "smooth preset",
  "beat sync",
  "slowmo preset",
  "sad edit",
  "anime edit",
  "amv alight motion",
  "cinematic preset",
  "aesthetic preset",
  "old preset",
  "preset terbaru",
  "preset lama",
  "mobile legends edit",
  "free fire edit",
  "collab edit",
  "alight motion transition",
  "preset hd",
  "preset no watermark",
  "preset am",
  "preset indo",
  "preset viral",
  "preset jj",
  "jj preset",
  "preset beat",
  "preset glow",
  "preset glitch",
  "preset zoom",
  "preset flash",
  "preset mirror",
  "preset rgb",
  "preset color",
  "preset text",
  "preset lyric",
  "lyric preset",
  "preset tiktok",
  "xml preset",
  "paket 5mb",
  "share alight",
  "alight share",
];

/** Real TikTok hashtags the scanner walks to discover preset content. */
export const PRESET_HASHTAGS: string[] = [
  "presetalightmotion",
  "alightmotionpreset",
  "presetam",
  "presetxml",
  "preset5mb",
  "jedagjedug",
  "softspoken",
  "velocity",
  "alightmotion",
  "alightmotionedit",
  "presetindo",
  "presetedit",
  "amvpreset",
  "cinematicpreset",
  "sadedit",
  "animeedit",
  "mobilelegendsedit",
  "freefireedit",
  "presetviral",
  "presetjj",
  "jjpreset",
  "presetbeat",
  "xmlpreset",
  "5mbpreset",
  "alightmotionindonesia",
  "presetalight",
];

/** Verified Alight Motion preset creators used for creator scans. */
export const PRESET_CREATORS: string[] = [
  "veyyuzumaki",
  "fajaruzumaki",
  "xnyzprst",
  "dentz_prst",
];

/** Rounds the background worker over so coverage keeps rotating. */
export function nextKeyword(previous?: string): string {
  const index = previous ? PRESET_KEYWORDS.indexOf(previous) : -1;
  return PRESET_KEYWORDS[(index + 1) % PRESET_KEYWORDS.length]!;
}

export function nextHashtag(previous?: string): string {
  const index = previous ? PRESET_HASHTAGS.indexOf(previous) : -1;
  return PRESET_HASHTAGS[(index + 1) % PRESET_HASHTAGS.length]!;
}
