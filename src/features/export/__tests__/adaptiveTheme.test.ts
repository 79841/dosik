import { describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import {
  COLOR_TOKENS,
  DARK_COLOR_TOKENS,
  PALETTE_COLORS,
  SURFACE_DARK,
} from "../../../shared/lib/palette";
import { mergeThemes } from "../adaptiveTheme";
import { renderVectorSvg } from "../vectorSvg";
import { allShapesDoc } from "./fixtures/allShapes";

/**
 * `theme: "auto"` — one SVG that follows wherever it is shown (#202). A chat
 * without a background of its own showed light-theme ink on a dark chat as
 * near-invisible shapes: the model drawing it cannot know the chat's theme.
 */
describe("SVG that follows the screen's theme (#202)", () => {
  const doc = allShapesDoc();
  const auto = renderVectorSvg(doc, { theme: "auto", background: false });
  const light = renderVectorSvg(doc, { theme: "light", background: false });
  const darkColors = (markup: string) =>
    new Set([...markup.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{3,8})"/g)].map((m) => m[1]));

  it("Light colors as attributes, dark colors as style rules — one and the same drawing", () => {
    expect(auto).toContain("<style>");
    // Attributes stay light — a viewer that ignores styles still reads it as light
    const withoutThemeClasses = (markup: string) =>
      markup.replace(/ class="dk[\w-]+"/g, "").replace(/ dk[\w-]+(?=")/g, "");
    expect(withoutThemeClasses(auto.replace(/<style>[\s\S]*?<\/style>/, ""))).toBe(light);
    // Every color the dark theme uses is in the rules
    const rules = auto.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(rules).toContain(SURFACE_DARK.edgeStroke);
    for (const color of darkColors(renderVectorSvg(doc, { theme: "dark", background: false }))) {
      if (!darkColors(light).has(color!)) expect(rules).toContain(color!);
    }
  });

  it("Tile fills stay the light pastels in dark too — the rules don't change tile fills (#216 T8)", () => {
    const rules = auto.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const ruleOf = new Map(
      [...rules.matchAll(/\.(dk[\w-]+) \{ ([^}]*) \}/g)].map((m) => [m[1]!, m[2]!]),
    );
    const pastel = new Set(
      PALETTE_COLORS.filter((c) => c !== "ink").map((c) => COLOR_TOKENS[c].fill),
    );
    let tiles = 0;
    for (const [tag, fill] of auto.matchAll(/<\w+ [^>]*\bfill="(#[0-9A-Fa-f]{6})"[^>]*>/g)) {
      if (!pastel.has(fill!)) continue;
      tiles += 1;
      const dark = /class="[^"]*\b(dk[\w-]+)/.exec(tag)?.[1];
      if (dark) expect(ruleOf.get(dark), tag).not.toMatch(/\bfill:/);
    }
    expect(tiles).toBeGreaterThan(5);
    // a blue tile has nothing to switch: no theme class at all
    const blue = auto.match(new RegExp(`<rect [^>]*fill="${COLOR_TOKENS.blue.fill}"[^>]*>`))?.[0];
    expect(blue).toBeDefined();
    expect(blue).not.toMatch(/class="dk/);
  });

  it("The inverted ink tile flips in dark — its fill is in the rules (#216 R3)", () => {
    const hero = makeNode({ id: "hero", shape: "rect", color: "ink", label: "Hero" });
    const merged = renderVectorSvg(makeDoc([hero], []), { theme: "auto", background: false });
    const rules = merged.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(merged).toContain(`fill="${COLOR_TOKENS.ink.fill}"`);
    expect(rules).toContain(`fill: ${DARK_COLOR_TOKENS.ink.fill}`);
  });

  it("Uses the theme the host reports first, otherwise the system setting", () => {
    const rules = auto.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(rules).toMatch(/\[data-mode="dark"\] \.dk/);
    expect(rules).toMatch(/\[data-theme="dark"\] \.dk/);
    expect(rules).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-mode\]\):not\(\[data-theme\]\):not\(\.light\) \.dk/,
    );
  });

  it("Identical color swaps share one class — the rules don't grow with the shape count", () => {
    const classes = new Set([...auto.matchAll(/class="(dk[\w-]+)"/g)].map((m) => m[1]));
    const tagged = [...auto.matchAll(/class="dk[\w-]+"/g)].length;
    expect(classes.size).toBeLessThan(tagged);
  });

  it("Rejects two drawings of different shape — if anything other than color differs they can't be merged", () => {
    expect(() =>
      mergeThemes('<svg><rect fill="#fff"/></svg>', '<svg><circle fill="#000"/></svg>'),
    ).toThrow();
    expect(() =>
      mergeThemes('<svg><rect x="1" fill="#fff"/></svg>', '<svg><rect x="2" fill="#000"/></svg>'),
    ).toThrow();
  });

  it("Small example: only the differing colors become classes and rules", () => {
    const merged = mergeThemes(
      '<svg><title>t</title><rect fill="#fff" stroke="#111"></rect><path d="M0 0" stroke="#999"></path></svg>',
      '<svg><title>t</title><rect fill="#000" stroke="#111"></rect><path d="M0 0" stroke="#999"></path></svg>',
    );
    expect(merged).toMatch(/<rect fill="#fff" stroke="#111" class="(dk[\w-]+)"><\/rect>/);
    expect(merged).toContain('<path d="M0 0" stroke="#999"></path>');
    expect(merged).toMatch(/\.dk[\w-]+ \{ fill: #000 \}/);
  });

  it("A tag that already has a class gets appended to that class — a duplicated attribute is not valid XML", () => {
    const merged = mergeThemes(
      '<svg><path class="edge" stroke="#999"></path></svg>',
      '<svg><path class="edge" stroke="#555"></path></svg>',
    );
    expect(merged).toMatch(/<path class="edge (dk[\w-]+)" stroke="#999"><\/path>/);
    expect(merged.match(/<path[^>]*>/)?.[0].match(/class=/g)).toHaveLength(1);
    // The whole real drawing parses as XML
    const dom = new DOMParser().parseFromString(auto, "image/svg+xml");
    expect(dom.getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it("The drawing paints its own background only when guessing from the system setting — prevents dark text on a white page", () => {
    const rules = auto.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    const media = rules.slice(rules.indexOf("@media"));
    // When the page declares a theme (the earlier rules) there is no background — the page's own background is right
    expect(rules.slice(0, rules.indexOf("@media"))).not.toContain("background");
    expect(media).toContain(`background: ${SURFACE_DARK.canvasBg}`);
    // A page that declares light via class (<html class="light">) is not guessed either
    expect(media).toContain(":not(.light)");
    // Opened directly as a file, the svg is :root — the same rule applies
    expect(media).toMatch(/svg:root\.dk[\w-]+-root/);
    // The root svg carries that class
    expect(auto).toMatch(/^<svg [^>]*class="(dk[\w-]+-root)"/);
  });
});
