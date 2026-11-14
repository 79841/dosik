import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SURFACE_DARK } from "../../../shared/lib/palette";
import { useDiagramStore } from "../../../shared/lib/store";
import type { DiagramDoc } from "../../../shared/lib/types";
import { renderVectorSvg } from "../vectorSvg";
import { allShapesDoc } from "./fixtures/allShapes";

/** what Studio added on top of every shape: ink, badges in all their spots, cards, faceless colour */
const studioExtrasDoc = (): DiagramDoc => {
  const n = (id: string, shape: string, x: number, y: number, extra: object = {}) => ({
    op: "add_node",
    node: { id, label: id, shape, x, y, ...extra },
  });
  const ops = [
    n("vpc", "frame", 0, 0, { width: 900, height: 420, badge: "1", color: "blue" }),
    n("edge", "frame", 0, 460, { width: 400, height: 200, badge: "beta" }),
    n("hero", "rect", 40, 60, { color: "ink", icon: "server", badge: "2", height: 84 }),
    n("short", "rect", 240, 60, { badge: "beta", description: "short box", height: 56 }),
    n("tall", "rect", 440, 60, { badge: "beta", icon: "cloud", height: 84 }),
    n("dia", "diamond", 640, 60, { badge: "3", color: "violet" }),
    n("oval", "ellipse", 40, 200, { badge: "beta", color: "teal" }),
    n("glyph", "icon", 240, 200, { icon: "database", color: "ink" }),
    n("words", "text", 440, 200, { color: "rose" }),
    n("bare", "class", 640, 200, { color: "violet" }),
    n("tbl", "entity", 40, 300, { color: "amber" }),
    n("L1", "lifeline", 40, 700, { width: 120, height: 300 }),
    n("L2", "lifeline", 300, 700, { width: 120, height: 300, color: "ink" }),
    { op: "add_activation", lifeline: "L2", y0: 60, y1: 160 },
    { op: "add_message", message: { from: "L1", to: "L2", y: 800, label: "call" } },
    n("alt", "fragment", 0, 760, { width: 480, height: 120, fragmentKind: "alt", branches: 2 }),
  ];
  useDiagramStore.getState().loadDoc({ version: 1, title: "", nodes: [], edges: [] }, null);
  const result = useDiagramStore.getState().applyOps(ops as never, true);
  if (result.errors.length > 0) throw new Error(result.errors.join("; "));
  return useDiagramStore.getState().toDoc();
};

/** The Studio style (#210) on every renderer: the canvas and the windowless SVG. */
describe("Studio — no shadows, and light/dark renders that pair", () => {
  const doc = allShapesDoc();

  it("the vector SVG draws no shadow filters, in either theme (#210 D4)", () => {
    for (const theme of ["light", "dark"] as const) {
      const svg = renderVectorSvg(doc, { theme });
      expect(svg).not.toContain("dsk-shadow");
      expect(svg).not.toMatch(/<filter\b/);
      expect(svg).not.toMatch(/\sfilter="/);
    }
  });

  it("the canvas node draws no drop shadow either", () => {
    const source = readFileSync(join(__dirname, "..", "..", "canvas", "ShapeNode.tsx"), "utf8");
    expect(source).not.toMatch(/drop-shadow/);
  });

  it("theme auto merges the two renders — it does not fall back to light", () => {
    const svg = renderVectorSvg(doc, { theme: "auto" });
    expect(svg).toContain("<style");
    expect(svg).toContain(SURFACE_DARK.canvasBg);
  });

  it("so does a page of everything Studio added — ink, badges, cards, a message on a bar", () => {
    const svg = renderVectorSvg(studioExtrasDoc(), { theme: "auto" });
    expect(svg).toContain("<style");
    expect(svg).toContain(SURFACE_DARK.canvasBg);
  });
});
