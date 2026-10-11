import sharp from "sharp";
import { APP } from "../config";

const WIDTH = 1080;
const HEIGHT = 1350;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word wrap for a monospace-agnostic sans stack at a given px size. */
function wrap(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const paragraphs = text.split(/\n+/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharsPerLine) {
        if (current) lines.push(current);
        if (word.length > maxCharsPerLine) {
          for (let i = 0; i < word.length; i += maxCharsPerLine) {
            lines.push(word.slice(i, i + maxCharsPerLine));
          }
          current = "";
        } else {
          current = word;
        }
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  if (lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines);
    trimmed[maxLines - 1] = `${trimmed[maxLines - 1]!.slice(0, maxCharsPerLine - 3)}...`;
    return trimmed;
  }
  return lines;
}

function stars(rating: number): string {
  return `${"★".repeat(rating)}${"☆".repeat(Math.max(0, 5 - rating))}`;
}

/**
 * Renders the premium review card as a real PNG on the server using sharp
 * (SVG composition — no headless browser required).
 */
export async function renderReviewImage(input: {
  reviewId: string;
  username: string;
  rating: number;
  body: string;
  createdAt: string;
}): Promise<Buffer> {
  const created = new Date(input.createdAt);
  const dateLabel = created.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });

  const bodyLines = wrap(input.body, 42, 12);
  const nameLines = wrap(input.username, 26, 2);

  const bodyText = bodyLines
    .map(
      (line, index) =>
        `<text x="90" y="${560 + index * 54}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="36" fill="#e9edf5">${escapeXml(line)}</text>`,
    )
    .join("");

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07070a"/>
      <stop offset="55%" stop-color="#0b0b12"/>
      <stop offset="100%" stop-color="#050505"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="18%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>

  <rect x="40" y="40" width="${WIDTH - 80}" height="${HEIGHT - 80}" rx="46" fill="#ffffff" fill-opacity="0.035" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
  <rect x="40" y="40" width="${WIDTH - 80}" height="${HEIGHT - 80}" rx="46" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="10" />

  <text x="90" y="150" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="46" font-weight="700" fill="#ffffff" letter-spacing="2">${escapeXml(APP.nameCn)} | ${escapeXml(APP.name)}</text>
  <text x="90" y="200" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="28" fill="#9aa3b2" letter-spacing="6">NEW WEBSITE REVIEW</text>
  <rect x="90" y="230" width="900" height="3" fill="url(#accent)"/>

  <text x="90" y="330" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="26" fill="#8b93a3" letter-spacing="4">USERNAME</text>
  ${nameLines
    .map(
      (line, index) =>
        `<text x="90" y="${390 + index * 52}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join("")}

  <text x="90" y="${390 + nameLines.length * 52 + 30}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="60" fill="#ffffff" letter-spacing="10">${escapeXml(stars(input.rating))}</text>
  <text x="90" y="${390 + nameLines.length * 52 + 78}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="28" fill="#9aa3b2">Rating ${input.rating} dari 5</text>

  <text x="90" y="${560 - 50}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="26" fill="#8b93a3" letter-spacing="4">ULASAN</text>
  ${bodyText}

  <text x="90" y="${HEIGHT - 200}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="26" fill="#8b93a3" letter-spacing="4">REVIEW ID</text>
  <text x="90" y="${HEIGHT - 160}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="30" fill="#ffffff">${escapeXml(input.reviewId)}</text>
  <text x="90" y="${HEIGHT - 110}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="28" fill="#9aa3b2">${escapeXml(dateLabel)} WIB</text>

  <rect x="90" y="${HEIGHT - 90}" width="900" height="2" fill="#ffffff" fill-opacity="0.25"/>
  <text x="90" y="${HEIGHT - 55}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="26" fill="#c9d0dc">Powered by ${escapeXml(APP.developer)}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
