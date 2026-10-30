/**
 * Split an AI Advisor answer into Markdown prose and interactive widget blocks.
 *
 * The model is asked to fence widgets as ```aidss:widget … ``` but does not
 * always emit the backticks, so we key off the `aidss:widget` marker and
 * brace-match the JSON that follows — fenced or not. Anything still arriving
 * mid-stream (an unterminated JSON object, or a partial marker at the very end)
 * is held back rather than shown raw. Pure and framework-free so it can be unit
 * tested without pulling in React.
 */

export type Segment =
  | { kind: "md"; text: string }
  | { kind: "widget"; data: unknown };

const MARKER = "aidss:widget";

/**
 * End (exclusive) of the balanced JSON object beginning at `start` (which must
 * point at `{`), or -1 if it is not yet complete — the normal case mid-stream.
 * String contents and escapes are skipped so braces inside strings don't throw
 * off the depth count.
 */
export function balancedJsonEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

// Trailing fragment that could be the start of "```aidss:widget" still
// streaming in — held back so a half-typed marker never flashes as prose.
const PARTIAL_MARKER = /`{0,3}(?:a(?:i(?:d(?:s(?:s(?::(?:w(?:i(?:d(?:g(?:e(?:t)?)?)?)?)?)?)?)?)?)?)?)?$/;

export function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const pushMd = (text: string) => {
    if (text.trim()) segments.push({ kind: "md", text });
  };

  let i = 0;
  while (i < content.length) {
    const idx = content.indexOf(MARKER, i);
    if (idx === -1) {
      // No further markers. Drop a trailing partial marker so it doesn't flash.
      pushMd(content.slice(i).replace(PARTIAL_MARKER, ""));
      break;
    }

    // Prose before the marker, minus any opening code fence (```/```json/…).
    pushMd(content.slice(i, idx).replace(/`{3}[a-zA-Z]*\s*$/, ""));

    const braceStart = content.indexOf("{", idx + MARKER.length);
    if (braceStart === -1) break; // JSON not started yet — wait for more.

    const end = balancedJsonEnd(content, braceStart);
    if (end === -1) break; // JSON still streaming — hold the block back.

    try {
      segments.push({ kind: "widget", data: JSON.parse(content.slice(braceStart, end)) });
    } catch {
      /* malformed JSON in a completed block — skip it silently */
    }

    // Skip an optional closing fence after the JSON.
    const closing = content.slice(end).match(/^\s*`{3}/);
    i = end + (closing ? closing[0].length : 0);
  }

  return segments;
}
