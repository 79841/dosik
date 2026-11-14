import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DESIGN_TOKENS,
  DS_DIR,
  dsColor,
  REPO_ROOT,
  readRepo,
  type ThemeName,
  themed,
} from "../../../test/designTokens";
import {
  CHROME_DARK,
  CHROME_LIGHT,
  type ChromeColors,
  COLOR_TOKENS,
  DARK_COLOR_TOKENS,
  PALETTE_COLORS,
  SURFACE_DARK,
  SURFACE_LIGHT,
  type SurfaceTokens,
} from "../palette";

/**
 * The design system (`design/design-system/dosik_tokens.py`) is the one source
 * of the app's colours, shadows and faces (#216). It writes `tokens.json` and
 * `tokens.css`; the app imports the CSS, and the values the app has to repeat as
 * hex (SVG, PNG, the MCP view, first paint) are pinned to the JSON.
 */
const CSS = readFileSync(join(DS_DIR, "tokens.css"), "utf8");

/** the `--name: value;` declarations of the block that opens with exactly `selector {` */
const block = (css: string, selector: string): Map<string, string> => {
  const lines = css.split("\n");
  const start = lines.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const vars = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (line === "}") break;
    const m = /^\s*--([\w\\.-]+):\s*(.+);$/.exec(line);
    if (m) vars.set(m[1]!.replace(/\\/g, ""), m[2]!);
  }
  return vars;
};

const LIGHT = block(CSS, ':root, [data-theme="light"]');
const DARK = block(CSS, '[data-theme="dark"]');
const PLAIN = block(CSS, ":root");

/** a `{reference}` in tokens.json is `var(--reference)` in the CSS */
const cssValue = (v: string) => (v.startsWith("{") ? `var(--${v.slice(1, -1)})` : v);

describe("design system tokens: tokens.css follows tokens.json (#216 T1)", () => {
  it("every colour token is in the light block, and in the dark block or inherited from light", () => {
    expect(DESIGN_TOKENS.color.tokens.length).toBeGreaterThan(40);
    for (const { name, value } of DESIGN_TOKENS.color.tokens) {
      expect(LIGHT.get(name), name).toBe(cssValue(themed(value, "light")));
      expect(DARK.get(name) ?? LIGHT.get(name), name).toBe(cssValue(themed(value, "dark")));
    }
  });

  it("the shadows have a light and a dark value", () => {
    expect(DESIGN_TOKENS.shadow.tokens.map((t) => t.name)).toEqual([
      "shadow-raised",
      "shadow-lifted",
      "shadow-popover",
      "shadow-overlay",
      "shadow-segment",
    ]);
    for (const { name, value } of DESIGN_TOKENS.shadow.tokens) {
      expect(LIGHT.get(name), name).toBe(value.light);
      expect(DARK.get(name), name).toBe(value.dark);
    }
  });

  it("the two faces, the spaces, radii and layout sizes are in the theme-free block", () => {
    expect(PLAIN.get("font-sans")).toBe(DESIGN_TOKENS.type.families.sans);
    expect(PLAIN.get("font-mono")).toBe(DESIGN_TOKENS.type.families.mono);
    expect(DESIGN_TOKENS.type.families.sans).toMatch(/^"Manrope",/);
    expect(DESIGN_TOKENS.type.families.mono).toMatch(/^"IBM Plex Mono",/);
    for (const { name, value } of [
      ...DESIGN_TOKENS.spacing.tokens,
      ...DESIGN_TOKENS.radius.tokens,
      ...DESIGN_TOKENS.layout.tokens,
    ]) {
      expect(PLAIN.get(name), name).toBe(value);
    }
  });

  it("type styles are `.type-*` classes — no bare global class leaks into other markup (Q1)", () => {
    // Mermaid's preview SVG has <g class="label">: a global `.label {}` restyled it
    expect(CSS).not.toMatch(
      /^\.(title-xl|title-lg|title|body-strong|body|caption|label|micro|tile-label|line-label)\s*\{/m,
    );
    for (const group of DESIGN_TOKENS.type.groups) {
      for (const style of group.styles) expect(CSS).toContain(`.type-${style.name} {`);
    }
  });
});

describe("design/ in the repository (#216 R5)", () => {
  // the canvas sources are not in every checkout of this code; where they are
  // absent there is no installed copy to compare
  it.skipIf(!existsSync(join(REPO_ROOT, "design", "app-chrome")))(
    "the design canvas's installed copy of the system is the generated one",
    () => {
      for (const file of ["tokens.css", "tokens.json", "components/bundle.css"]) {
        expect(readRepo("design", "app-chrome", "project", "ds", "dosik", file), file).toBe(
          readFileSync(join(DS_DIR, file), "utf8"),
        );
      }
    },
  );

  // a source download without .git (a release's zip) has no index to read;
  // every checkout, CI's included, has one
  it.skipIf(!existsSync(join(REPO_ROOT, ".git")))(
    "no script or document points at a machine's own folders",
    () => {
      // what git tracks, not what lies on this disk: untracked local files never
      // reach the repository, so they are not this test's business
      const tracked = execFileSync("git", ["ls-files", "-z", "--", "design"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      })
        .split("\0")
        // a tracked file already deleted from the disk leaves with the next commit
        .filter((p) => p !== "" && existsSync(join(REPO_ROOT, p)));
      const text = tracked.filter((p) => /\.(py|md|html|json|css)$/.test(p));
      // never vacuous: the full design sources where they are checked out, at
      // the least the two generated token files everywhere
      const canvas = existsSync(join(REPO_ROOT, "design", "app-chrome"));
      expect(text.length).toBeGreaterThanOrEqual(canvas ? 20 : 2);
      const hits = text.filter((p) =>
        /\/private\/tmp|\/Users\//.test(readFileSync(join(REPO_ROOT, p), "utf8")),
      );
      expect(hits).toEqual([]);
    },
  );
});

/** which design-system token each canvas surface role is (#216 plan, R2 · D2) */
const SURFACE_TOKEN: Record<keyof SurfaceTokens, string> = {
  canvasBg: "surface",
  canvasDot: "dot",
  panelBg: "surface",
  edgeStroke: "ink",
  ink: "ink",
  inkMuted: "muted",
  lifeline: "dash",
  act: "selected",
  cardBody: "surface",
  cardBorder: "selected",
};
const CHROME_TOKEN: Record<keyof ChromeColors, string> = {
  ink: "ink",
  muted: "muted",
  line: "line",
  hover: "hover",
};
const THEMES: [ThemeName, SurfaceTokens, ChromeColors][] = [
  ["light", SURFACE_LIGHT, CHROME_LIGHT],
  ["dark", SURFACE_DARK, CHROME_DARK],
];

describe("palette.ts hex values are the design system's (#216 T2)", () => {
  it("the canvas surfaces — SVG, PNG and the MCP view cannot read CSS variables", () => {
    for (const [theme, surface] of THEMES) {
      for (const [key, token] of Object.entries(SURFACE_TOKEN)) {
        expect(surface[key as keyof SurfaceTokens], `${theme} ${key}`).toBe(dsColor(token, theme));
      }
    }
  });

  it("the MCP view's chrome colours", () => {
    for (const [theme, , chrome] of THEMES) {
      for (const [key, token] of Object.entries(CHROME_TOKEN)) {
        expect(chrome[key as keyof ChromeColors], `${theme} ${key}`).toBe(dsColor(token, theme));
      }
    }
  });
});

describe("Studio tiles are the design system's tile tokens (#216)", () => {
  const has = (name: string) => DESIGN_TOKENS.color.tokens.some((t) => t.name === name);

  it("face, cap, label and glyph — wherever the system names that colour's role", () => {
    let pinned = 0;
    let faces = 0;
    let caps = 0;
    for (const color of PALETTE_COLORS.filter((c) => c !== "ink")) {
      for (const tokens of [COLOR_TOKENS, DARK_COLOR_TOKENS]) {
        const token = tokens[color];
        expect(token.text, color).toBe(dsColor("tile-ink", "light"));
        if (has(`tile-${color}`)) {
          expect(token.fill, color).toBe(dsColor(`tile-${color}`, "light"));
          faces += 1;
        }
        if (has(`tile-${color}-cap`)) {
          expect(token.cap, color).toBe(dsColor(`tile-${color}-cap`, "light"));
          caps += 1;
        }
        if (has(`deep-${color}`)) {
          expect(token.glyph, color).toBe(dsColor(`deep-${color}`, "light"));
          pinned += 1;
        }
      }
    }
    // a renamed tile token would skip its check and still pass — count them
    expect(faces).toBe(16); // eight hues × two themes
    expect(caps).toBe(14); // gray has no cap in the system
    expect(pinned).toBe(10); // violet, blue, teal, amber, rose × two themes
  });

  it("mono's glyph keeps its warm grey — the one value left off the system's tile-ink-muted (Q6)", () => {
    // #4A4743 against #4A4A4A: matching it is a visual change outside #216's scope
    expect(COLOR_TOKENS.mono.glyph).toBe("#4A4743");
    expect(dsColor("tile-ink-muted", "light")).toBe("#4A4A4A");
  });
});
