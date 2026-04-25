export interface VttCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

const TIMESTAMP_RE =
  /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/;

function toSeconds(h: string | undefined, m: string, s: string, ms: string | undefined): number {
  const hh = h ? parseInt(h, 10) : 0;
  const mm = parseInt(m, 10);
  const ss = parseInt(s, 10);
  const msec = ms ? parseInt(ms.padEnd(3, "0").slice(0, 3), 10) : 0;
  return hh * 3600 + mm * 60 + ss + msec / 1000;
}

/**
 * Parse a WebVTT string into cue objects. Strips the WEBVTT header,
 * cue identifiers, and any inline tag markup. Only timing + text remain.
 *
 * Tolerant of CRLF and missing milliseconds.
 */
export function parseVtt(vtt: string | null | undefined): VttCue[] {
  if (!vtt) return [];
  const out: VttCue[] = [];
  const lines = vtt.replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  // Skip header / NOTE blocks until first cue with timestamps
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    const match = line.match(TIMESTAMP_RE);
    if (!match) {
      i++;
      continue;
    }
    const startSeconds = toSeconds(match[1], match[2]!, match[3]!, match[4]);
    const endSeconds = toSeconds(match[5], match[6]!, match[7]!, match[8]);
    i++;
    const textParts: string[] = [];
    while (i < lines.length) {
      const t = lines[i];
      if (t === undefined || t.trim() === "") break;
      // Skip inline cue settings continuation; treat as text
      textParts.push(t.replace(/<[^>]+>/g, ""));
      i++;
    }
    const text = textParts.join(" ").trim();
    if (text) out.push({ startSeconds, endSeconds, text });
  }
  return out;
}
