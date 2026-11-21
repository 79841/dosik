import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contrast, dsColor, readRepo, type ThemeName } from "../../../test/designTokens";
import {
  ACCENT_BUTTON,
  ACCENT_SOFT,
  ACCENT_SURFACE,
  FOCUS_ITEM,
  FOCUS_RING,
  THEME_PRIMARY,
  TEXT_MUTED,
  TEXT_MUTED_HOVER,
  TEXT_MUTED_ON_FILL,
} from "../palette";

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : sources(path);
    return /\.(tsx?|css)$/.test(path) ? [path] : [];
  });

const SOURCES = sources(join(process.cwd(), "src"));
const FILES = SOURCES.filter((p) => !p.endsWith("palette.ts"));
const read = (path: string) => readFileSync(path, "utf8");
const offenders = (pattern: RegExp): string[] => FILES.filter((path) => pattern.test(read(path)));
/** every match of a global pattern in the app's sources, as `file: match` */
const hits = (pattern: RegExp): string[] =>
  SOURCES.flatMap((path) =>
    [...read(path).matchAll(pattern)].map(
      (m) => `${path.slice(process.cwd().length + 1)}: ${m[0]}`,
    ),
  );

/** Tailwind's colour utilities, and its own palette's hues */
const COLOR_UTILITY =
  "(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|shadow|inset-shadow|drop-shadow|fill|stroke|outline|divide|decoration|accent|caret|placeholder|from|via|to)";
const TAILWIND_HUE =
  "(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";
/** a palette colour class with any variant chain, `!important` and opacity */
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*!?${COLOR_UTILITY}-${TAILWIND_HUE}(?:-\\d+)?(?:/\\d+)?(?![\\w-])`,
  "g",
);
/**
 * Mermaid source highlighting (`MermaidPreview` `TOKEN_CLASS`): four syntax
 * colours the design system has no token for — code, not chrome.
 */
const SYNTAX_COLORS = [
  "text-sky-700",
  "dark:text-sky-300",
  "text-emerald-700",
  "dark:text-emerald-300",
  "text-amber-700",
  "dark:text-amber-300",
  "text-pink-700",
  "dark:text-pink-300",
].map((name) => `src/features/mermaid/MermaidPreview.tsx: ${name}`);

const APP_CSS = readRepo("src", "App.css");
const TOKENS_CSS = readRepo("design", "design-system", "project", "tokens.css");
/** the block that turns tokens into Tailwind utilities */
const THEME_BLOCK = /@theme inline reference \{([^}]*)\}/.exec(APP_CSS)?.[1] ?? "";

/** colours and shadows the chrome draws with — `bg-surface`, `text-muted`, `shadow-raised`… */
const COLOR_UTILITIES = [
  "surface",
  "frame",
  "hover",
  "selected",
  "line",
  "line-strong",
  "edge",
  "frame-dash",
  "ink",
  "icon",
  "muted",
  "muted-strong",
  "ink-surface",
  "on-ink-muted",
  "danger",
  "success",
  "focus",
  "tile-rose",
  "tile-ink",
  // the error toast's alert icon on its rose tile, the same in both themes (#231 D18)
  "deep-rose",
  // Home's START pictures, the Blank tile and the dot grid (#220)
  "tile-mono",
  "tile-blue",
  "tile-teal",
  "tile-violet",
  "tile-green",
  "tile-amber",
  "tile-ink-muted",
  "dot",
  "dash",
  "on-ink-line",
  "on-ink-soft",
  // the design system's project colours — the sidebar's project dots (#217
  // D25) and the brand mark drew with them; both are gone (#229, #231 D17),
  // the tokens stay
  "project-grey",
  "project-amber",
  "project-violet",
  "line-blue",
  // a folder or a diagram glyph, duotone by kind (#236 D2)
  "glyph-folder",
  "glyph-folder-soft",
  "glyph-diagram",
  "glyph-diagram-soft",
  // a project's badge: its first letter on a tint, the colour from its id (#236 D3)
  ...["blue", "teal", "orange", "pink", "green", "violet"].flatMap((c) => [
    `badge-${c}`,
    `badge-${c}-soft`,
  ]),
  // the Windows Close caption button: the system's red under the pointer, a
  // deeper red while pressed, the white glyph on it (the canvas's Win-Caption)
  "caption-close",
  "caption-close-pressed",
  "on-caption-close",
];
const SHADOW_UTILITIES = ["raised", "lifted", "popover", "overlay", "segment"];

describe("the design system's tokens are the chrome's colours (#216 R1)", () => {
  it("App.css imports tokens.css as it is — no layer, so its faces beat Tailwind's defaults", () => {
    const imports = APP_CSS.split("\n").filter((line) => line.includes("tokens.css"));
    expect(imports).toEqual(['@import "../design/design-system/project/tokens.css";']);
  });

  it("each semantic utility reads the token of its name, and tokens.css defines it", () => {
    // `inline` makes a utility read the variable where it is used, so one class
    // follows data-theme; `reference` keeps Tailwind from re-declaring the
    // variables as `--shadow-raised: var(--shadow-raised)`, a cycle
    expect(THEME_BLOCK).not.toBe("");
    for (const name of COLOR_UTILITIES) {
      expect(THEME_BLOCK).toContain(`--color-${name}: var(--${name});`);
    }
    for (const name of SHADOW_UTILITIES) {
      expect(THEME_BLOCK).toContain(`--shadow-${name}: var(--shadow-${name});`);
    }
    for (const [, token] of THEME_BLOCK.matchAll(/var\(--([\w-]+)\)/g)) {
      expect(TOKENS_CSS, token).toMatch(new RegExp(`^\\s*--${token}:`, "m"));
    }
  });

  it("primary stays, as another name for the ink (#158)", () => {
    expect(ACCENT_SURFACE).toBe("bg-primary text-primary-fg");
    expect(ACCENT_BUTTON).toContain("hover:bg-primary-hover");
    expect(THEME_BLOCK).toContain("--color-primary: var(--ink);");
    expect(THEME_BLOCK).toContain("--color-primary-fg: var(--surface);");
    expect(THEME_BLOCK).toMatch(
      /--color-primary-hover: color-mix\(in oklab, var\(--ink\) \d+%, var\(--surface\)\);/,
    );
    // the SVG fallback is the light ink
    expect(THEME_PRIMARY).toBe(`var(--ink, ${dsColor("ink", "light")})`);
  });

  it("App.css keeps no colour of its own — the only hex left is the canvas fallback", () => {
    expect(APP_CSS).not.toContain("--dsk-primary");
    expect(APP_CSS).not.toContain("IBM Plex");
    // comments name issues (#158), which read like hex
    const code = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect([...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])).toEqual(["#FFFFFF"]);
    expect(APP_CSS).toContain("var(--dsk-canvas-bg, #FFFFFF)");
    // no dark overrides: the tokens switch with data-theme
    expect(APP_CSS).not.toMatch(/^\[data-theme="dark"\][^{]*\{/m);
  });

  it("the chrome constants are semantic utilities — no light/dark pair to get wrong", () => {
    expect(TEXT_MUTED).toBe("text-muted");
    expect(TEXT_MUTED_HOVER).toBe("hover:text-ink");
    // a tinted fill eats the margin, so text on one steps up a notch
    expect(TEXT_MUTED_ON_FILL).toBe("text-muted-strong");
    expect(ACCENT_SOFT).toBe("bg-selected text-ink");
    expect(FOCUS_RING).toBe(
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    );
    expect(FOCUS_ITEM).toBe("focus-visible:outline-hidden focus-visible:bg-hover");
  });

  it("muted text on a frame button steps up to muted-strong when the hover fills it selected", () => {
    // muted on selected is 4.27:1 in light — under AA (#216 result)
    expect(
      hits(/(?:text-muted|\$\{TEXT_MUTED\}) hover:bg-selected(?! hover:text-muted-strong)/g),
    ).toEqual([]);
  });

  // muted never rests on selected: a frame button's hover steps it up to muted-strong (test above)
  it("text passes AA on the surfaces it rests on, in both themes (tokens.json)", () => {
    const pairs: [string, string[]][] = [
      ["muted", ["surface", "frame", "hover"]],
      ["muted-strong", ["hover", "selected"]],
      ["ink", ["surface", "frame", "hover", "selected"]],
      ["icon", ["surface", "frame", "hover", "selected"]],
      ["danger", ["surface", "frame"]],
      ["success", ["surface"]],
      ["surface", ["ink-surface"]],
      ["on-ink-muted", ["ink-surface"]],
      ["tile-ink", ["tile-rose"]],
      // the error toast's icon: `danger` is a bright rose in dark, lost on the light tile (#231 D18)
      ["deep-rose", ["tile-rose"]],
    ];
    for (const theme of ["light", "dark"] as ThemeName[]) {
      for (const [fg, backgrounds] of pairs) {
        for (const bg of backgrounds) {
          expect(
            contrast(dsColor(fg, theme), dsColor(bg, theme)),
            `${fg} on ${bg} (${theme})`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

/** `rgba(r, g, b, a)` laid over an opaque `#RRGGBB`, as `#RRGGBB` */
const over = (fg: string, bg: string): string => {
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(fg);
  if (!m) return fg;
  const alpha = Number(m[4]);
  const back = [1, 3, 5].map((i) => Number.parseInt(bg.slice(i, i + 2), 16));
  const mixed = [1, 2, 3].map((i, k) => Math.round(alpha * Number(m[i]) + (1 - alpha) * back[k]!));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

/** where a row, a card or a header puts a glyph or a badge (#236) */
const MARK_GROUNDS = ["surface", "frame", "hover", "selected"];
const BADGE_HUES = ["blue", "teal", "orange", "pink", "green", "violet"];

describe("folder and diagram glyphs, project badges (#236 D2·D3)", () => {
  it("a glyph's stroke keeps 3:1 against every ground it sits on, in both themes (non-text contrast)", () => {
    for (const theme of ["light", "dark"] as ThemeName[]) {
      for (const glyph of ["glyph-folder", "glyph-diagram"]) {
        for (const ground of MARK_GROUNDS) {
          expect(
            contrast(dsColor(glyph, theme), dsColor(ground, theme)),
            `${glyph} on ${ground} (${theme})`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("a badge's letter stays readable on its tint — a floor against washing out", () => {
    // The badge is decoration: aria-hidden, the project's name beside it is what
    // is read. The owner picked these hues over darker ones (#236 D3); the
    // lowest today is light orange on a selected row, 2.67:1.
    for (const theme of ["light", "dark"] as ThemeName[]) {
      for (const hue of BADGE_HUES) {
        for (const ground of MARK_GROUNDS) {
          const tint = over(dsColor(`badge-${hue}-soft`, theme), dsColor(ground, theme));
          expect(
            contrast(dsColor(`badge-${hue}`, theme), tint),
            `badge-${hue} on its tint over ${ground} (${theme})`,
          ).toBeGreaterThanOrEqual(2.5);
        }
      }
    }
  });
});

describe("chrome colours come only from the design system (#216 T4)", () => {
  it("no zinc class is left — the chrome's greys are tokens", () => {
    expect(hits(/zinc-\d/g)).toEqual([]);
  });

  it("no Tailwind palette colour — but the Mermaid syntax colours", () => {
    const found = hits(PALETTE_CLASS);
    expect(found.filter((hit) => !SYNTAX_COLORS.includes(hit))).toEqual([]);
    // the allowance names what is really there
    expect(SYNTAX_COLORS.filter((hit) => !found.includes(hit))).toEqual([]);
  });

  it("no `dark:` colour twin — a token switches with the theme by itself", () => {
    const twins = hits(new RegExp(`(?<![\\w-])dark:(?:[\\w-]+:)*!?${COLOR_UTILITY}-[\\w/-]+`, "g"));
    expect(twins.filter((hit) => !SYNTAX_COLORS.includes(hit))).toEqual([]);
  });

  it("no Tailwind default shadow — a lift is shadow-raised, -lifted, -popover, -overlay or -segment", () => {
    expect(hits(/(?<![\w-])(?:[\w-]+:)*!?shadow-(?:2xs|xs|sm|md|lg|xl|2xl)(?![\w-])/g)).toEqual([]);
  });

  it("keyboard focus uses the single focus ring token — no hand-written focus outlines (#178)", () => {
    expect(FOCUS_RING).toContain("focus-visible:outline-focus");
    expect(offenders(/focus-visible:outline-(?:\d|primary|focus|offset|none|hidden)/)).toEqual([]);
  });

  it("no purple Tailwind classes remain — primary is the only accent (#158)", () => {
    // the pastel `violet` node colour stays (palette.ts); chrome must not use the hue
    expect(offenders(/\b(?:bg|text|border|ring|shadow|accent|fill|stroke)-violet-\d/)).toEqual([]);
  });
});
