import { describe, expect, it } from "vitest";

import { BORDER_TITLE } from "../palette";
import { DECOR, stepAnchor, tagOrigin, tagWidth } from "../nodeDecor";
import { cylinderCapRy, hexagonCut, parallelogramSkew } from "../sideAttach";
import { textWidth } from "../textLayout";
import type { ShapeKind } from "../types";

const HALF = Math.SQRT1_2;

/** whether a point lies inside a `shape` node `w` × `h` (its silhouette, not its box) */
const inside = (shape: ShapeKind, w: number, h: number, x: number, y: number): boolean => {
  switch (shape) {
    case "ellipse":
      return ((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2 <= 1;
    case "diamond":
      return Math.abs(x - w / 2) / (w / 2) + Math.abs(y - h / 2) / (h / 2) <= 1;
    case "parallelogram": {
      const skew = parallelogramSkew(w);
      return x >= skew * (1 - y / h) && x <= w - (skew * y) / h;
    }
    case "hexagon": {
      const cut = hexagonCut(w);
      const reach = (cut * Math.abs(y - h / 2)) / (h / 2);
      return x >= reach && x <= w - reach;
    }
    case "cylinder":
      // below the lid's rim
      return y >= cylinderCapRy(h) * 2 && x >= 0 && x <= w && y <= h;
    default:
      return x >= 0 && x <= w && y >= 0 && y <= h;
  }
};

describe("where a step circle sits (#210)", () => {
  it("on the box's top-right corner", () => {
    for (const shape of ["rect", "rounded", "sticky", "parallelogram", "frame"] as const) {
      expect(stepAnchor(shape, 160, 80)).toEqual({ x: 160, y: 0 });
    }
  });

  it("on a curved or cut shape, on the outline — not in the air past it", () => {
    const at = (shape: ShapeKind) => stepAnchor(shape, 160, 80);
    expect(at("diamond")).toEqual({ x: 120, y: 20 });
    expect(at("hexagon")).toEqual({ x: 160 - hexagonCut(160), y: 0 });
    const ellipse = at("ellipse");
    expect(ellipse.x).toBeCloseTo(80 + 80 * HALF, 5);
    expect(ellipse.y).toBeCloseTo(40 - 40 * HALF, 5);
    const ry = cylinderCapRy(80);
    const cylinder = at("cylinder");
    expect(cylinder.x).toBeCloseTo(80 + 80 * HALF, 5);
    expect(cylinder.y).toBeCloseTo(ry - ry * HALF, 5);
  });
});

describe("where a badge tag sits (#210)", () => {
  it("its width is the upper-cased text plus its padding", () => {
    expect(tagWidth("beta")).toBeCloseTo(textWidth("BETA", DECOR.tagFontSize) + DECOR.tagPadX * 2);
  });

  it("inside a box's top-left corner, at any height — never on the outline where lines end", () => {
    for (const h of [40, 56, 84]) {
      expect(tagOrigin("rect", 160, h, 33)).toEqual({ x: DECOR.tagInset, y: DECOR.tagInset });
    }
  });

  it("a cylinder's sits under the lid, where the tag's tone does not melt into it", () => {
    expect(tagOrigin("cylinder", 160, 90, 33)).toEqual({
      x: DECOR.tagInset,
      y: cylinderCapRy(90) * 2 + 4,
    });
  });

  it("a shape whose left side leans keeps the tag clear of it", () => {
    const para = tagOrigin("parallelogram", 160, 56, 33);
    expect(para.x).toBeGreaterThan(DECOR.tagInset);
    const hex = tagOrigin("hexagon", 160, 80, 33);
    expect(hex.x).toBeGreaterThan(DECOR.tagInset);
  });

  it("on every other shape the whole tag lies inside the silhouette", () => {
    for (const shape of ["ellipse", "diamond", "parallelogram", "hexagon", "cylinder"] as const) {
      for (const [w, h] of [
        [160, 56],
        [140, 90],
        [200, 80],
      ] as const) {
        const tagW = tagWidth("beta");
        const { x, y } = tagOrigin(shape, w, h, tagW);
        const corners = [
          [x, y],
          [x + tagW, y],
          [x, y + DECOR.tagHeight],
          [x + tagW, y + DECOR.tagHeight],
        ] as const;
        for (const [cx, cy] of corners) {
          expect(inside(shape, w, h, cx, cy), `${shape} ${w}x${h} (${cx}, ${cy})`).toBe(true);
        }
      }
    }
  });

  it("a frame's is set into its top border, at the right", () => {
    expect(tagOrigin("frame", 400, 300, 33)).toEqual({
      x: 400 - BORDER_TITLE.inset - 33,
      y: -DECOR.tagHeight / 2,
    });
  });
});
