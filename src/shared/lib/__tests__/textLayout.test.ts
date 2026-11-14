import { describe, expect, it } from "vitest";

import { advance, ellipsize, textWidth, wrapText } from "../textLayout";

/**
 * Rules for laying out labels without a window (#148). Widths were measured in a browser with the app font:
 * IBM Plex Mono Latin 0.6em (monospace), Hangul/Han/Kana 0.865em via a fallback font, emoji 1em.
 */
describe("textWidth", () => {
  it("Latin is monospace at 0.6em", () => {
    expect(textWidth("SQL", 11)).toBeCloseTo(3 * 11 * 0.6);
    expect(advance("A")).toBe(0.6);
    expect(advance(" ")).toBe(0.6);
  });

  it("Hangul, Han and Kana are 0.865em — drawn with a fallback font", () => {
    expect(advance("결")).toBe(0.865);
    expect(advance("漢")).toBe(0.865);
    expect(advance("カ")).toBe(0.865);
    expect(textWidth("결제A", 13)).toBeCloseTo(13 * (0.865 * 2 + 0.6));
  });

  it("emoji are 1em and a surrogate pair counts as one character", () => {
    expect(textWidth("😀", 10)).toBeCloseTo(10);
  });

  it("a ZWJ sequence or VS16 is one character — counting per code point would widen it (#152)", () => {
    expect(textWidth("👨‍👩‍👧", 10)).toBeCloseTo(10);
    expect(textWidth("❤️", 10)).toBeCloseTo(10);
    expect(textWidth("a❤️b", 10)).toBeCloseTo(10 * (0.6 + 1 + 0.6));
  });
});

describe("wrapText — follows CSS pre-wrap + break-words", () => {
  const W = (chars: number, size = 10) => chars * size * 0.6;

  it("one line when it fits", () => {
    expect(wrapText("Auth Service", W(20), 10)).toEqual(["Auth Service"]);
  });

  it("breaks lines at spaces", () => {
    expect(wrapText("Auth Service Gateway", W(12), 10)).toEqual(["Auth Service", "Gateway"]);
  });

  it("breaks by character when one word is wider than the width", () => {
    expect(wrapText("Supercalifragilistic", W(8), 10)).toEqual(["Supercal", "ifragili", "stic"]);
  });

  it("a newline character becomes a line break", () => {
    expect(wrapText("a\nb", W(20), 10)).toEqual(["a", "b"]);
  });

  it("Hangul can break between syllables — as in the browser", () => {
    // 4 syllables = 4 × 0.865 × 10 = 34.6, 3 syllables = 25.95
    expect(wrapText("결제서비", 30, 10)).toEqual(["결제서", "비"]);
  });

  it("an empty string has no lines, not one empty line", () => {
    expect(wrapText("", W(10), 10)).toEqual([]);
  });
});

describe("ellipsize — for single-line truncation such as icon labels", () => {
  it("leaves it alone when it fits", () => {
    expect(ellipsize("API", 100, 10)).toBe("API");
  });

  it("when it overflows, fits within the width including the ellipsis", () => {
    const out = ellipsize("Payment Gateway", 10 * 0.6 * 8, 10);
    expect(out.endsWith("…")).toBe(true);
    expect(textWidth(out, 10)).toBeLessThanOrEqual(10 * 0.6 * 8);
  });
});
