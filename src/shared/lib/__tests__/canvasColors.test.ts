import { describe, expect, it } from "vitest";

import { contrast } from "../../../test/designTokens";
import {
  canvasInk,
  COLOR_TOKENS,
  DARK_COLOR_TOKENS,
  nodeLabelColor,
  onCanvasColor,
  PALETTE_COLORS,
  SURFACE_DARK,
  SURFACE_LIGHT,
} from "../palette";
import type { PaletteColor } from "../types";

const THEMES = [
  ["light", COLOR_TOKENS, SURFACE_LIGHT],
  ["dark", DARK_COLOR_TOKENS, SURFACE_DARK],
] as const;

describe("colour drawn on the bare canvas (#210)", () => {
  it("onCanvasColor: the given ink when uncoloured, else the colour as it reads on the canvas", () => {
    expect(onCanvasColor("mono", COLOR_TOKENS, "#123456")).toBe("#123456");
    expect(onCanvasColor("rose", COLOR_TOKENS, "#123456")).toBe(COLOR_TOKENS.rose.stroke);
    // ink's deep tone is the white it puts on its own tile — never on the canvas
    expect(onCanvasColor("ink", COLOR_TOKENS, "#123456")).toBe(COLOR_TOKENS.ink.line);
  });

  it("text a node draws on its tile is the tile's label colour", () => {
    for (const shape of ["rect", "sticky", "lifeline", "class"] as const) {
      expect(nodeLabelColor({ shape, color: "ink" }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
        COLOR_TOKENS.ink.text,
      );
    }
  });

  it("an icon node has no tile: its label is the page's ink in every colour (D15)", () => {
    for (const color of PALETTE_COLORS) {
      expect(nodeLabelColor({ shape: "icon", color }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
        SURFACE_LIGHT.ink,
      );
      expect(nodeLabelColor({ shape: "icon", color }, DARK_COLOR_TOKENS, SURFACE_DARK)).toBe(
        SURFACE_DARK.ink,
      );
    }
  });

  it("the text shape has no tile: ink when uncoloured, its colour otherwise — never invisible", () => {
    expect(nodeLabelColor({ shape: "text", color: "mono" }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
      SURFACE_LIGHT.ink,
    );
    expect(nodeLabelColor({ shape: "text", color: "rose" }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
      COLOR_TOKENS.rose.stroke,
    );
    expect(nodeLabelColor({ shape: "text", color: "ink" }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
      COLOR_TOKENS.ink.line,
    );
  });

  it("a frame titles in its border colour, a fragment's guard is quiet ink", () => {
    expect(nodeLabelColor({ shape: "frame", color: "mono" }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
      SURFACE_LIGHT.inkMuted,
    );
    expect(nodeLabelColor({ shape: "frame", color: "blue" }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
      COLOR_TOKENS.blue.stroke,
    );
    expect(nodeLabelColor({ shape: "fragment", color: "blue" }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
      SURFACE_LIGHT.inkMuted,
    );
  });

  it("a colour an old file names but the palette no longer has falls back to violet", () => {
    const legacy = "purple" as PaletteColor;
    expect(onCanvasColor(legacy, COLOR_TOKENS, "#000000")).toBe(COLOR_TOKENS.violet.stroke);
    expect(nodeLabelColor({ shape: "rect", color: legacy }, COLOR_TOKENS, SURFACE_LIGHT)).toBe(
      COLOR_TOKENS.violet.text,
    );
  });

  it("every colour's text on the bare canvas passes AA (4.5:1) in both themes", () => {
    const hues = PALETTE_COLORS.filter((c): c is PaletteColor => c !== "mono");
    for (const color of hues) {
      const light = onCanvasColor(color, COLOR_TOKENS, SURFACE_LIGHT.ink);
      const dark = onCanvasColor(color, DARK_COLOR_TOKENS, SURFACE_DARK.ink);
      expect(contrast(light, SURFACE_LIGHT.canvasBg), `${color} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark, SURFACE_DARK.canvasBg), `${color} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every colour drawn on the bare canvas passes AA on that theme's canvas (#216 T7)", () => {
    for (const [theme, tokens, surface] of THEMES) {
      for (const color of PALETTE_COLORS) {
        expect(
          contrast(canvasInk(color, tokens), surface.canvasBg),
          `${color} ${theme}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("colour on a tile (#216 T6)", () => {
  it("a tile's label passes AA on its face, its glyph 3:1 — in both themes", () => {
    for (const [theme, tokens] of THEMES) {
      for (const color of PALETTE_COLORS) {
        const { fill, text, glyph } = tokens[color];
        expect(contrast(text, fill), `${color} ${theme} label`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(glyph, fill), `${color} ${theme} glyph`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
