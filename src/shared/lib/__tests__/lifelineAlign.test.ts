import { describe, expect, it } from "vitest";

import { alignTops, distributeEvenly } from "../lifelineAlign";
import type { DiagramNode } from "../types";

const node = (id: string, x: number, y: number, width = 120): DiagramNode =>
  ({
    id,
    type: "shape",
    position: { x, y },
    width,
    height: 360,
    data: { label: id, shape: "lifeline", color: "violet" },
  }) as DiagramNode;

describe("alignTops", () => {
  it("aligns to the topmost y", () => {
    const out = alignTops([node("a", 0, 100), node("b", 300, 40), node("c", 600, 220)]);
    expect(out).toEqual([
      { id: "a", y: 40 },
      { id: "c", y: 40 },
    ]);
  });

  it("no patch when already aligned", () => {
    expect(alignTops([node("a", 0, 40), node("b", 300, 40)])).toEqual([]);
  });

  it("one or fewer is a no-op", () => {
    expect(alignTops([node("a", 0, 100)])).toEqual([]);
    expect(alignTops([])).toEqual([]);
  });
});

describe("distributeEvenly", () => {
  it("keeps both ends and spaces the rest evenly", () => {
    const out = distributeEvenly([node("a", 0, 0), node("b", 100, 0), node("c", 600, 0)]);
    expect(out).toEqual([{ id: "b", x: 300 }]);
  });

  it("sorts by x before computing (input order does not matter)", () => {
    const out = distributeEvenly([node("c", 600, 0), node("a", 0, 0), node("b", 100, 0)]);
    expect(out).toEqual([{ id: "b", x: 300 }]);
  });

  it("no patch when already evenly spaced", () => {
    expect(distributeEvenly([node("a", 0, 0), node("b", 300, 0), node("c", 600, 0)])).toEqual([]);
  });

  it("two or fewer is a no-op", () => {
    expect(distributeEvenly([node("a", 0, 0), node("b", 300, 0)])).toEqual([]);
  });

  it("gaps (edge-to-edge) become even with different widths", () => {
    // with equal widths this matches center spacing, so a regression in this rule would go unnoticed
    const nodes = [node("a", 0, 0, 100), node("b", 50, 0, 300), node("c", 1000, 0, 120)];
    const patches = distributeEvenly(nodes);
    const final = nodes
      .map((n) => ({
        ...n,
        position: { ...n.position, x: patches.find((p) => p.id === n.id)?.x ?? n.position.x },
      }))
      .sort((l, r) => l.position.x - r.position.x);
    const gaps = final
      .slice(1)
      .map((n, i) => n.position.x - (final[i]!.position.x + (final[i]!.width ?? 0)));
    expect(final[0]?.position.x).toBe(0); // both ends stay
    expect(final[2]?.position.x).toBe(1000);
    for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(1); // rounding error only
  });

  it("without enough room, overlaps evenly with negative gaps", () => {
    // the convention in design tools — distribute evenly as asked and let the user see the overlap
    const nodes = [node("a", 0, 0, 200), node("b", 10, 0, 200), node("c", 300, 0, 200)];
    const patches = distributeEvenly(nodes);
    expect(patches).toEqual([{ id: "b", x: 150 }]);
  });
});
