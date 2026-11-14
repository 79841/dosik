import { describe, expect, it } from "vitest";

import { makeNode } from "../../../../shared/lib/__tests__/testFixtures";
import { nodeBounds } from "../../../../shared/lib/edgeUtils";
import { landingDelta } from "../landing";

/** two 160×56 boxes side by side — a block 460 wide, 56 tall */
const fragment = {
  nodes: [makeNode({ id: "p", x: 0, y: 0 }), makeNode({ id: "q", x: 300, y: 0 })],
  edges: [],
};

describe("landingDelta — centered on the current view, clear of existing shapes (#200 D5)", () => {
  it("On an empty page the center of the piece lands on the center of the view", () => {
    expect(landingDelta(fragment, { x: 1000, y: 500 }, [], "TB")).toEqual({ dx: 770, dy: 472 });
  });

  it("Moves aside in the flow direction when shapes overlap — down for TB, right for LR", () => {
    const there = makeNode({ id: "x", x: 900, y: 450 });
    const down = landingDelta(fragment, { x: 1000, y: 500 }, [there], "TB");
    expect(down.dx).toBe(770);
    expect(down.dy).toBeGreaterThan(472);
    const right = landingDelta(fragment, { x: 1000, y: 500 }, [there], "LR");
    expect(right.dy).toBe(472);
    expect(right.dx).toBeGreaterThan(770);
    // and it really is clear
    const b = nodeBounds(there);
    for (const n of fragment.nodes) {
      const box = nodeBounds(n);
      const at = { ...box, x: box.x + down.dx, y: box.y + down.dy };
      expect(
        at.y >= b.y + b.height ||
          at.y + at.height <= b.y ||
          at.x >= b.x + b.width ||
          at.x + at.width <= b.x,
      ).toBe(true);
    }
  });

  it("Does not squeeze the new diagram into gaps — the whole block moves aside (checked in the app)", () => {
    // the gap between p (0..160) and q (300..460), once centred on x 1000, is 930..1070
    const inGap = makeNode({ id: "x", x: 950, y: 480, width: 100, height: 40 });
    const delta = landingDelta(fragment, { x: 1000, y: 500 }, [inGap], "TB");
    // the block's top (its shapes start at y 0) is below the shape's bottom (520)
    expect(delta.dy).toBeGreaterThanOrEqual(520);
  });

  it("Does not land inside a frame — if it did, it would become the frame's contents", () => {
    const frame = makeNode({ id: "f", x: 400, y: 200, width: 600, height: 400, shape: "frame" });
    const delta = landingDelta(fragment, { x: 700, y: 350 }, [frame], "TB");
    // below the frame's bottom edge (600), not inside it
    expect(delta.dy).toBeGreaterThanOrEqual(600);
  });
});
