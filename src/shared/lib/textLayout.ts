/**
 * Label widths and line breaks without a browser (#148).
 *
 * The app sets every diagram label in IBM Plex Mono, which is monospaced, so
 * Latin text measures by counting — the canvas (`font-mono` on the flow) and
 * the SVG export (`FONT_MONO`) keep that face while the interface around them
 * is Manrope (#216). Hangul, Han and kana are not in the font and fall
 * back to a system face; their advance was measured in the app's own font
 * stack (Chromium, 13px/600 and 11px/500 alike): 0.865em. Emoji measured 1em.
 * These are the numbers the canvas would produce, not a guess at them.
 */
const LATIN = 0.6;
const WIDE = 0.865;
const EMOJI = 1;

const isWide = (code: number): boolean =>
  (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
  (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, punctuation
  (code >= 0x3040 && code <= 0x30ff) || // kana
  (code >= 0x3130 && code <= 0x318f) || // Hangul compatibility Jamo
  (code >= 0x3400 && code <= 0x9fff) || // CJK ideographs
  (code >= 0xac00 && code <= 0xd7af) || // Hangul syllables
  (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
  (code >= 0xffe0 && code <= 0xffe6);

const isEmoji = (ch: string): boolean => /\p{Extended_Pictographic}/u.test(ch);

/** advance of one character, in em */
export const advance = (ch: string): number => {
  const code = ch.codePointAt(0) ?? 0;
  if (isWide(code)) return WIDE;
  if (isEmoji(ch)) return EMOJI;
  return LATIN;
};

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * What the eye sees as one character. A family emoji is five code points
 * (three people joined by ZWJ) and a red heart is two (the heart and VS16);
 * counted per code point they measured 4.2em and 1.6em for one glyph each
 * (#152). Without `Intl.Segmenter` (WebKit before macOS 11.3) it falls
 * back to code points. A project's badge letter is the first of these (#236).
 */
export const graphemes = (text: string): string[] =>
  segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);

const clusterAdvance = (cluster: string): number => {
  if (isEmoji(cluster)) return EMOJI;
  let em = 0;
  for (const ch of cluster) em += advance(ch);
  return em;
};

export const textWidth = (text: string, fontSize: number): number => {
  let em = 0;
  for (const cluster of graphemes(text)) em += clusterAdvance(cluster);
  return em * fontSize;
};

/** a place a line may break *before*: after a space, or between two wide characters */
const tokens = (paragraph: string): string[] => {
  const out: string[] = [];
  let current = "";
  let prevWide = false;
  for (const ch of graphemes(paragraph)) {
    const wide = isWide(ch.codePointAt(0) ?? 0);
    if (current && (wide || prevWide) && !current.endsWith(" ")) {
      out.push(current);
      current = "";
    }
    current += ch;
    if (ch === " ") {
      out.push(current);
      current = "";
    }
    prevWide = wide;
  }
  if (current) out.push(current);
  return out;
};

/**
 * Greedy line breaking the way the canvas label does it —
 * `white-space: pre-wrap; overflow-wrap: break-word`: newlines are lines, a
 * line breaks at spaces (and between CJK characters), and a word longer than
 * the line breaks inside itself. Trailing spaces hang, as in CSS.
 */
export const wrapText = (text: string, maxWidth: number, fontSize: number): string[] => {
  if (text === "") return [];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    const fits = (s: string) => textWidth(s.trimEnd(), fontSize) <= maxWidth + 0.01;
    for (const token of tokens(paragraph)) {
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (line) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (fits(token)) {
        line = token;
        continue;
      }
      // a single token wider than the line: break it by character
      for (const ch of graphemes(token)) {
        if (line && !fits(line + ch)) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
};

/** one line, cut with an ellipsis so it fits — `text-overflow: ellipsis` */
export const ellipsize = (text: string, maxWidth: number, fontSize: number): string => {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  const ellipsis = "…";
  let out = "";
  for (const ch of graphemes(text)) {
    if (textWidth(out + ch + ellipsis, fontSize) > maxWidth) break;
    out += ch;
  }
  return out + ellipsis;
};
