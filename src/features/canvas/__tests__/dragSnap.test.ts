import { describe, expect, it } from "vitest";

import { AUTO_PAN_DISTANCE, inAutoPanZone, snapDrop } from "../dragSnap";

/**
 * #228 — a dragged shape shakes at the canvas edge.
 *
 * While a drag's pointer is within 40px of the canvas edge (outside included),
 * React Flow slides the view by a fraction of a pixel every frame
 * (`calcAutoPan`). Meanwhile the shape moves only in 8px steps, so it saws back
 * and forth under the pointer. This pins down the rule that marks out that
 * zone, and the rule that puts a shape dropped in it back on the grid.
 */
const pane = { left: 100, top: 50, width: 800, height: 600 };

describe("auto-pan zone (#228)", () => {
  it("the distance is React Flow's default, 40px", () => {
    expect(AUTO_PAN_DISTANCE).toBe(40);
  });

  it("the middle of the canvas is not in the zone", () => {
    expect(inAutoPanZone({ x: 500, y: 350 }, pane)).toBe(false);
  });

  it("within 40px of any of the four edges is in the zone", () => {
    expect(inAutoPanZone({ x: 100 + 39, y: 350 }, pane)).toBe(true); // left
    expect(inAutoPanZone({ x: 100 + 800 - 39, y: 350 }, pane)).toBe(true); // right
    expect(inAutoPanZone({ x: 500, y: 50 + 39 }, pane)).toBe(true); // top
    expect(inAutoPanZone({ x: 500, y: 50 + 600 - 39 }, pane)).toBe(true); // bottom
  });

  it("exactly 40px away is not in the zone — the boundary where calcAutoPan gives 0", () => {
    expect(inAutoPanZone({ x: 100 + 40, y: 350 }, pane)).toBe(false);
    expect(inAutoPanZone({ x: 100 + 800 - 40, y: 350 }, pane)).toBe(false);
    expect(inAutoPanZone({ x: 500, y: 50 + 40 }, pane)).toBe(false);
    expect(inAutoPanZone({ x: 500, y: 50 + 600 - 40 }, pane)).toBe(false);
  });

  it("outside the canvas is in the zone too — the view slides there as well", () => {
    expect(inAutoPanZone({ x: 20, y: 350 }, pane)).toBe(true);
    expect(inAutoPanZone({ x: 1200, y: 350 }, pane)).toBe(true);
    expect(inAutoPanZone({ x: 500, y: -10 }, pane)).toBe(true);
    expect(inAutoPanZone({ x: 500, y: 900 }, pane)).toBe(true);
  });

  it("takes another distance", () => {
    expect(inAutoPanZone({ x: 100 + 30, y: 350 }, pane, 20)).toBe(false);
    expect(inAutoPanZone({ x: 100 + 19, y: 350 }, pane, 20)).toBe(true);
  });
});

describe("a shape dropped in the zone goes back on the grid (#228)", () => {
  it("one shape goes to the nearest 8px cell — rounded like React Flow's snapPosition", () => {
    expect(snapDrop([{ id: "a", position: { x: 13.4, y: 99.7 } }], [8, 8])).toEqual([
      { id: "a", position: { x: 16, y: 96 } },
    ]);
    expect(snapDrop([{ id: "a", position: { x: 11.9, y: 4.1 } }], [8, 8])).toEqual([
      { id: "a", position: { x: 8, y: 8 } },
    ]);
  });

  it("nothing to change when already on the grid", () => {
    expect(snapDrop([{ id: "a", position: { x: 16, y: 96 } }], [8, 8])).toEqual([]);
  });

  it("several move together by the first one's correction and keep their spacing — like React Flow's multi-node drag", () => {
    const moves = snapDrop(
      [
        { id: "a", position: { x: 13.4, y: 99.7 } },
        // a shape off the grid to begin with — its spacing must be kept
        { id: "b", position: { x: 213.4 + 3, y: 199.7 } },
      ],
      [8, 8],
    );
    expect(moves).toEqual([
      { id: "a", position: { x: 16, y: 96 } },
      { id: "b", position: { x: 219, y: 196 } },
    ]);
  });

  it("nothing to change when several are already in place", () => {
    expect(
      snapDrop(
        [
          { id: "a", position: { x: 16, y: 96 } },
          { id: "b", position: { x: 219, y: 196 } },
        ],
        [8, 8],
      ),
    ).toEqual([]);
  });

  it("an empty list gives an empty list", () => {
    expect(snapDrop([], [8, 8])).toEqual([]);
  });
});
