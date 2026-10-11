/**
 * Fetches an Alight Motion / preset XML and injects the TikTok (or known) sound
 * URL so opening the file in AM can pick up audio without a separate download.
 *
 * AM project XML varies by version; we apply several safe, non-destructive
 * injection strategies and keep the original markup intact.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Build a small audio node many AM parsers tolerate as an extra media track. */
function audioSnippet(soundUrl: string, title?: string | null): string {
  const src = escapeXml(soundUrl);
  const name = escapeXml(title || "Preset Space Sound");
  return (
    `\n<!-- PresetSpace: auto-injected sound -->\n` +
    `<audio id="presetspace_sound" name="${name}" src="${src}" path="${src}" url="${src}" ` +
    `start="0" muted="false" volume="1" loop="false" autoplay="false"/>\n` +
    `<music src="${src}" url="${src}" title="${name}" volume="1"/>\n` +
    `<am_music path="${src}" url="${src}" name="${name}"/>\n`
  );
}

/**
 * Inject sound into XML text. Returns original XML if no sound URL or already present.
 */
export function injectSoundIntoXml(
  xml: string,
  soundUrl: string | null | undefined,
  soundTitle?: string | null,
): { xml: string; injected: boolean; reason?: string } {
  if (!soundUrl || !isHttpUrl(soundUrl)) {
    return { xml, injected: false, reason: "Tidak ada URL suara HTTP yang valid" };
  }
  if (xml.includes(soundUrl) || xml.includes("presetspace_sound")) {
    return { xml, injected: false, reason: "Suara sudah ada di XML" };
  }

  const snippet = audioSnippet(soundUrl, soundTitle);
  let next = xml;
  let injected = false;

  // Prefer inserting before common closing roots
  for (const closer of ["</project>", "</Project>", "</alight>", "</Alight>", "</scene>", "</Scene>", "</composition>", "</root>", "</Root>"]) {
    if (next.includes(closer)) {
      next = next.replace(closer, `${snippet}${closer}`);
      injected = true;
      break;
    }
  }

  // JSON-in-XML / am export blobs
  if (!injected && /"musicUrl"\s*:/.test(next)) {
    next = next.replace(/"musicUrl"\s*:\s*(""|null)/, `"musicUrl":"${soundUrl.replace(/"/g, '\\"')}"`);
    injected = true;
  }
  if (!injected && /"audioUrl"\s*:/.test(next)) {
    next = next.replace(/"audioUrl"\s*:\s*(""|null)/, `"audioUrl":"${soundUrl.replace(/"/g, '\\"')}"`);
    injected = true;
  }

  if (!injected) {
    // Append before final tag or at end
    const lastClose = next.lastIndexOf("</");
    if (lastClose > 0) {
      next = next.slice(0, lastClose) + snippet + next.slice(lastClose);
      injected = true;
    } else {
      next = next + snippet;
      injected = true;
    }
  }

  return { xml: next, injected: true };
}

export async function fetchXmlText(url: string): Promise<{ ok: boolean; text?: string; contentType?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "application/xml,text/xml,text/plain,*/*",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { ok: false, error: `Upstream XML HTTP ${res.status}` };
    const text = await res.text();
    if (!text || text.length < 20) return { ok: false, error: "XML kosong" };
    return { ok: true, text, contentType: res.headers.get("content-type") ?? "application/xml" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "fetch gagal" };
  }
}
