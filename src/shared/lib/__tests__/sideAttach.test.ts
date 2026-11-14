import { describe, expect, it } from "vitest";

import {
  attachRange,
  handleRatio,
  nearestSide,
  outlineInset,
  parseSide,
  projectToSide,
  sideHandle,
} from "../sideAttach";

const box = { x: 100, y: 100, width: 160, height: 80 };

describe("side handles", () => {
  it("reads the side and the position along it", () => {
    expect(parseSide("left-25")).toBe("left");
    expect(parseSide("top")).toBe("top");
    expect(parseSide("center")).toBeNull();
    expect(parseSide(null)).toBeNull();
    expect(handleRatio("left-25")).toBe(0.25);
    expect(handleRatio("left")).toBe(0.5);
    expect(handleRatio("left-x")).toBe(0.5);
  });

  it("writes the bare side for the middle and two decimals otherwise", () => {
    expect(sideHandle("left", 0.5)).toBe("left");
    expect(sideHandle("left", 0.25)).toBe("left-25");
    expect(sideHandle("top", 1 / 3)).toBe("top-33.33");
    expect(sideHandle("top", 2)).toBe("top-100");
  });
});

describe("attachRange", () => {
  it("keeps a box's ends away from its corners", () => {
    expect(attachRange("rect", box, "left")).toEqual({ min: 8, max: 72 });
    expect(attachRange("rounded", box, "top")).toEqual({ min: 8, max: 152 });
  });

  it("uses only the middle half of a curved or slanted side", () => {
    expect(attachRange("ellipse", box, "top")).toEqual({ min: 40, max: 120 });
    expect(attachRange("diamond", box, "left")).toEqual({ min: 20, max: 60 });
    expect(attachRange("hexagon", box, "left")).toEqual({ min: 20, max: 60 });
  });

  it("keeps to the flat part of a hexagon's top", () => {
    expect(attachRange("hexagon", box, "top")).toEqual({ min: 26, max: 134 });
  });

  it("keeps off a sticky note's folded corner", () => {
    const note = { x: 0, y: 0, width: 170, height: 120 };
    const fold = Math.min(22, 170 * 0.3, 120 * 0.36);
    expect(attachRange("sticky", note, "right")).toEqual({ min: 8, max: 120 - fold });
    expect(attachRange("sticky", note, "bottom")).toEqual({ min: 8, max: 170 - fold });
    expect(attachRange("sticky", note, "left")).toEqual({ min: 8, max: 112 });
  });

  it("collapses to the middle when nothing is left", () => {
    expect(attachRange("rect", { x: 0, y: 0, width: 10, height: 10 }, "top")).toEqual({
      min: 5,
      max: 5,
    });
  });
});

describe("outlineInset", () => {
  it("is zero on a box and at a curved side's middle", () => {
    expect(outlineInset("rect", box, "left", 0.2)).toBe(0);
    expect(outlineInset("ellipse", box, "left", 0.5)).toBe(0);
    expect(outlineInset("diamond", box, "top", 0.5)).toBe(0);
  });

  it("follows the ellipse and the diamond inward", () => {
    // a quarter of the way down the left side of a 160x80 ellipse
    const ellipse = outlineInset("ellipse", box, "left", 0.25);
    expect(ellipse).toBeCloseTo(80 * (1 - Math.sqrt(1 - 0.25)), 6);
    expect(outlineInset("diamond", box, "left", 0.25)).toBeCloseTo(40, 6);
  });

  it("follows the slanted ends of a hexagon's top", () => {
    const cut = Math.min(26, 160 * 0.2);
    expect(outlineInset("hexagon", box, "top", 0)).toBeCloseTo(40, 6);
    expect(outlineInset("hexagon", box, "top", cut / 2 / 160)).toBeCloseTo(20, 6);
    expect(outlineInset("hexagon", box, "bottom", 1 - cut / 2 / 160)).toBeCloseTo(20, 6);
    expect(outlineInset("hexagon", box, "top", 0.5)).toBe(0);
    expect(outlineInset("hexagon", box, "left", 0.25)).toBeCloseTo(cut / 2, 6);
  });

  it("follows a parallelogram's cut corners on its top and bottom", () => {
    const skew = Math.min(24, 160 * 0.18);
    expect(outlineInset("parallelogram", box, "top", skew / 2 / 160)).toBeCloseTo(40, 6);
    expect(outlineInset("parallelogram", box, "top", 0.5)).toBe(0);
    expect(outlineInset("parallelogram", box, "bottom", 1 - skew / 2 / 160)).toBeCloseTo(40, 6);
    expect(outlineInset("parallelogram", box, "bottom", 0.5)).toBe(0);
  });

  it("follows a sticky note's folded corner", () => {
    const note = { x: 0, y: 0, width: 170, height: 120 };
    expect(outlineInset("sticky", note, "right", 1)).toBeCloseTo(22, 6);
    expect(outlineInset("sticky", note, "right", 0.5)).toBe(0);
    expect(outlineInset("sticky", note, "bottom", 160 / 170)).toBeCloseTo(12, 6);
    expect(outlineInset("sticky", note, "left", 1)).toBe(0);
  });

  it("follows a cylinder's caps but not its straight sides", () => {
    const ry = Math.min(14, 80 * 0.18);
    expect(outlineInset("cylinder", box, "top", 0.5)).toBe(0);
    expect(outlineInset("cylinder", box, "top", 0.25)).toBeCloseTo(ry * (1 - Math.sqrt(0.75)), 6);
    expect(outlineInset("cylinder", box, "left", 0.3)).toBe(0);
  });

  it("follows a parallelogram's slanted sides", () => {
    const skew = Math.min(24, 160 * 0.18);
    expect(outlineInset("parallelogram", box, "left", 0)).toBeCloseTo(skew, 6);
    expect(outlineInset("parallelogram", box, "left", 1)).toBeCloseTo(0, 6);
    expect(outlineInset("parallelogram", box, "right", 1)).toBeCloseTo(skew, 6);
  });
});

describe("projectToSide", () => {
  it("lands where the pointer is along the side", () => {
    expect(projectToSide("rect", box, "left", { x: 140, y: 120 })).toBe(0.25);
  });

  it("snaps to the middle within 8px", () => {
    expect(projectToSide("rect", box, "left", { x: 140, y: 147 })).toBe(0.5);
  });

  it("is held off the corners", () => {
    expect(projectToSide("rect", box, "left", { x: 140, y: 101 })).toBe(8 / 80);
    expect(projectToSide("ellipse", box, "top", { x: 101, y: 140 })).toBe(0.25);
  });
});

describe("nearestSide", () => {
  it("picks the closest side from outside and from inside", () => {
    expect(nearestSide(box, { x: 90, y: 140 })).toBe("left");
    expect(nearestSide(box, { x: 180, y: 95 })).toBe("top");
    expect(nearestSide(box, { x: 250, y: 140 })).toBe("right");
    expect(nearestSide(box, { x: 180, y: 175 })).toBe("bottom");
  });
});
