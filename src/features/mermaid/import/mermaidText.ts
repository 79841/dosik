import { COLOR_TOKENS, PALETTE_COLORS } from "../../../shared/lib/palette";
import type { PaletteColor } from "../../../shared/lib/types";

/**
 * Text as Mermaid's parser hands it back, made into plain label text (#200).
 *
 * Mermaid rewrites every `#…;` entity code before it parses — `#quot;`
 * arrives as `ﬂ°quot¶ß`, `#60;` as `ﬂ°°60¶ß` — and its sanitizer turns a
 * hand-written `<` into `&lt;`. Both become HTML entities again and are
 * decoded together, the way Mermaid itself does before drawing, so any named
 * entity (`#eacute;`, `#rarr;`) reads as it renders. A line break is `<br>` in
 * any spelling; formatting tags (`<b>`, `<i>`) are formatting the canvas does
 * not have, so their text stays and the tags go. `List<Item>` is a generic,
 * not a tag, and stays.
 */
const FORMATTING = /<\/?(b|i|u|s|em|strong|small|sub|sup|span|code|del|mark|font)\b[^>]*>/gi;

/**
 * HTML entities to text, in one pass — decoding one form after another would
 * read `#35;` + `59;` as `;`. A detached textarea parses what it is given as
 * text (no elements, no scripts), so this cannot inject markup.
 */
let decoder: HTMLTextAreaElement | null = null;
const decodeEntities = (html: string): string => {
  decoder ??= document.createElement("textarea");
  decoder.innerHTML = html;
  return decoder.value;
};

export const decodeLabel = (text: string | undefined): string =>
  decodeEntities(
    (text ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(FORMATTING, "")
      // Mermaid's sentinels, and the `#…;` codes in case a path skipped them
      .replace(/ﬂ°°/g, "&#")
      .replace(/ﬂ°/g, "&")
      .replace(/¶ß/g, ";")
      // (an `&` before it is already an entity — checked by offset: lookbehind
      // is past the build target, and older WebKit would throw on it)
      .replace(/#(\d+|[a-z]\w*);/gi, (whole, code: string, offset: number, all: string) =>
        all[offset - 1] === "&" ? whole : /^\d/.test(code) ? `&#${code};` : `&${code};`,
      ),
  ).trim();

type Rgb = [number, number, number];

const rgbOf = (value: string): Rgb | null => {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})\b/)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};

/**
 * Fills an older build wrote (the pre-#210 pastels) and plain white, which the
 * current tiles no longer sit nearest to — an export from before the Studio
 * style still comes back as the colour it was.
 */
const LEGACY_FILLS: readonly [string, PaletteColor][] = [
  ["#FFFFFF", "mono"],
  ["#EDE9FE", "violet"],
  ["#DBEAFE", "blue"],
  ["#CCFBF1", "teal"],
  ["#DCFCE7", "green"],
  ["#FEF3C7", "amber"],
  ["#FFE4E6", "rose"],
  ["#F4F4F5", "gray"],
];

const PALETTE_RGB = [
  ...PALETTE_COLORS.map((color) => ({ color, rgb: rgbOf(COLOR_TOKENS[color].fill)! })),
  ...LEGACY_FILLS.map(([hex, color]) => ({ color, rgb: rgbOf(hex)! })),
];

/**
 * The palette colour nearest a Mermaid `fill` (#200): `style` lines and
 * `classDef`s give any CSS colour, the canvas has a handful. Distance is to the
 * light palette's fills — the ones the export writes — so an exported colour
 * comes back as itself, plus the fills older builds wrote. Null when the styles
 * set no fill this can read.
 */
export const paletteFromStyles = (styles: readonly string[]): PaletteColor | null => {
  let fill: string | undefined;
  for (const style of styles) {
    const m = style.match(/^\s*fill\s*:\s*(.+?)\s*;?\s*$/i);
    if (m) fill = m[1];
  }
  const rgb = fill ? rgbOf(fill) : null;
  if (!rgb) return null;
  let best = PALETTE_RGB[0]!;
  let bestDistance = Infinity;
  for (const entry of PALETTE_RGB) {
    const d = entry.rgb.reduce((sum, c, i) => sum + (c - rgb[i]!) ** 2, 0);
    if (d < bestDistance) {
      best = entry;
      bestDistance = d;
    }
  }
  return best.color;
};
