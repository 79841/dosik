import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canvasInk,
  COLOR_TOKENS,
  DARK_COLOR_TOKENS,
  PALETTE_COLORS,
  SURFACE_DARK,
  SURFACE_LIGHT,
  THEME_COLOR_TOKENS,
} from "../palette";

const HEX = /^#[0-9A-F]{6}$/;
const FIELDS = ["fill", "stroke", "text", "cap", "line", "glyph"] as const;
const ROOT = join(__dirname, "..", "..", "..", "..");

describe("Studio colour tokens (#210)", () => {
  it("every colour has the six Studio roles in both themes", () => {
    for (const color of PALETTE_COLORS) {
      for (const tokens of [COLOR_TOKENS, DARK_COLOR_TOKENS]) {
        for (const field of FIELDS) expect(tokens[color][field]).toMatch(HEX);
      }
    }
  });

  it("light tiles and deep tones are the confirmed values (spec D2)", () => {
    const tile = (c: keyof typeof COLOR_TOKENS) => [COLOR_TOKENS[c].fill, COLOR_TOKENS[c].stroke];
    expect(tile("mono")).toEqual(["#EAE8E4", "#4A4743"]);
    expect(tile("violet")).toEqual(["#EEE9F8", "#5B3DB5"]);
    expect(tile("blue")).toEqual(["#E6EEF9", "#2B66B8"]);
    expect(tile("teal")).toEqual(["#E1F1EE", "#0E766D"]);
    expect(tile("green")).toEqual(["#E6F1E3", "#2E7535"]);
    // amber's deep tone darkened from the mockup's #B4600C to pass AA on the canvas (#210)
    expect(tile("amber")).toEqual(["#FBEFD9", "#A65809"]);
    expect(tile("rose")).toEqual(["#F8E7E6", "#B0243F"]);
    expect(tile("gray")).toEqual(["#ECEBEE", "#55545A"]);
  });

  it("a glyph on the tile is the deep tone (#216)", () => {
    for (const color of PALETTE_COLORS.filter((c) => c !== "ink")) {
      expect(COLOR_TOKENS[color].glyph, color).toBe(COLOR_TOKENS[color].stroke);
    }
  });

  it("labels on a tinted tile are ink, not the tile's hue — the light ink in both themes", () => {
    for (const color of PALETTE_COLORS.filter((c) => c !== "ink")) {
      expect(COLOR_TOKENS[color].text).toBe(SURFACE_LIGHT.ink);
      // the same pastel tile sits on the dark canvas, so its label stays dark (#216)
      expect(DARK_COLOR_TOKENS[color].text).toBe(SURFACE_LIGHT.ink);
    }
  });

  it("dark keeps the light tiles: face, cap, label and glyph are the light values (#216 T5)", () => {
    for (const color of PALETTE_COLORS.filter((c) => c !== "ink")) {
      for (const field of ["fill", "cap", "text", "glyph"] as const) {
        expect(DARK_COLOR_TOKENS[color][field], `${color}.${field}`).toBe(
          COLOR_TOKENS[color][field],
        );
      }
      // what is drawn on the bare canvas takes a bright tone there (D1)
      expect(DARK_COLOR_TOKENS[color].stroke, color).not.toBe(COLOR_TOKENS[color].stroke);
    }
    expect(SURFACE_DARK.ink).not.toBe(SURFACE_LIGHT.ink);
  });

  it("THEME_COLOR_TOKENS points every role at its CSS variable", () => {
    for (const field of FIELDS) {
      expect(THEME_COLOR_TOKENS.blue[field]).toBe(
        `var(--dsk-blue-${field}, ${COLOR_TOKENS.blue[field]})`,
      );
    }
  });
});

describe("Studio surfaces (#210)", () => {
  it("the canvas is the design system's white / near-black sheet and lines take the ink (#216)", () => {
    expect(SURFACE_LIGHT.canvasBg).toBe("#FFFFFF");
    expect(SURFACE_LIGHT.canvasDot).toBe("#E0E0E0");
    expect(SURFACE_LIGHT.ink).toBe("#1A1A1A");
    expect(SURFACE_DARK.canvasBg).toBe("#1C1C1C");
    expect(SURFACE_DARK.canvasDot).toBe("#2A2A2A");
    expect(SURFACE_DARK.ink).toBe("#EDEDED");
    // the panels are the same sheet as the canvas
    expect(SURFACE_LIGHT.panelBg).toBe(SURFACE_LIGHT.canvasBg);
    expect(SURFACE_DARK.panelBg).toBe(SURFACE_DARK.canvasBg);
    expect(SURFACE_LIGHT.edgeStroke).toBe(SURFACE_LIGHT.ink);
    expect(SURFACE_DARK.edgeStroke).toBe(SURFACE_DARK.ink);
  });

  it("carries the surface roles the components draw with", () => {
    for (const surface of [SURFACE_LIGHT, SURFACE_DARK]) {
      for (const key of ["ink", "inkMuted", "lifeline", "act", "cardBody", "cardBorder"] as const) {
        expect(surface[key]).toMatch(HEX);
      }
    }
  });

  it("hand-written canvas background fallbacks match the token (drift guard)", () => {
    const files = [
      "index.html",
      "src/App.tsx",
      "src/App.css",
      "src/features/canvas/DiagramCanvas.tsx",
      "src/shared/ui/ErrorBoundary.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const m of source.matchAll(/--dsk-canvas-bg,\s*(#[0-9A-Fa-f]{6})/g)) {
        expect(m[1].toUpperCase(), file).toBe(SURFACE_LIGHT.canvasBg);
      }
    }
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    expect(html).toContain(`"${SURFACE_DARK.canvasBg}"`);
    expect(html).toContain(`"${SURFACE_LIGHT.canvasBg}"`);
  });
});

describe("the ink colour — an inverted hero tile (#210 D22)", () => {
  it("comes last in the picker", () => {
    expect(PALETTE_COLORS.at(-1)).toBe("ink");
  });

  it("is near-black with white labels in light, and the reverse in dark", () => {
    expect(COLOR_TOKENS.ink).toEqual({
      fill: "#1F1E1D",
      stroke: "#FFFFFF",
      text: "#FFFFFF",
      cap: "#3A3836",
      line: "#1F1E1D",
      glyph: "#FFFFFF",
    });
    expect(DARK_COLOR_TOKENS.ink).toEqual({
      fill: "#F2F0ED",
      stroke: "#141312",
      text: "#141312",
      cap: "#D9D6D1",
      line: "#F2F0ED",
      glyph: "#141312",
    });
  });

  it("canvasInk keeps a colour visible where no tile sits behind it", () => {
    // ink's deep tone is white — on the bare canvas it would vanish
    expect(canvasInk("ink", COLOR_TOKENS)).toBe(COLOR_TOKENS.ink.line);
    expect(canvasInk("ink", DARK_COLOR_TOKENS)).toBe(DARK_COLOR_TOKENS.ink.line);
    expect(canvasInk("blue", COLOR_TOKENS)).toBe(COLOR_TOKENS.blue.stroke);
    expect(canvasInk("blue", THEME_COLOR_TOKENS)).toBe(THEME_COLOR_TOKENS.blue.stroke);
  });
});

describe("colour swatches (#210 D17)", () => {
  it("draw the tile with an edge in the colour as it reads on bare canvas", async () => {
    const { swatchStyle, THEME_EDGE_STROKE } = await import("../palette");
    expect(swatchStyle("blue", false)).toEqual({
      backgroundColor: THEME_COLOR_TOKENS.blue.fill,
      border: `2px solid ${THEME_COLOR_TOKENS.blue.stroke}`,
    });
    expect(swatchStyle("ink", false).border).toBe(`2px solid ${THEME_COLOR_TOKENS.ink.line}`);
    // an edge's "Default" swatch is the ink the line is drawn in
    expect(swatchStyle(undefined, true).border).toBe(`2px solid ${THEME_EDGE_STROKE}`);
    expect(swatchStyle(undefined, true).boxShadow).toContain(THEME_EDGE_STROKE);
  });

  it("no hard-coded slate edge colour is left in the app", () => {
    const hits = (readdirSync(join(ROOT, "src"), { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.includes("__tests__"))
      .filter((f) => /94A3B8/i.test(readFileSync(join(ROOT, "src", f), "utf8")));
    expect(hits).toEqual([]);
  });
});
