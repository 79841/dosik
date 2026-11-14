import { describe, expect, it } from "vitest";

import { middleSegmentIndices, slideSegment } from "../edgeGeometry";

describe("middleSegmentIndices", () => {
  it("a straight line has no middle segment", () => {
    expect(
      middleSegmentIndices([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toEqual([]);
  });

  it("an L bend has none either — both segments hold an endpoint", () => {
    expect(
      middleSegmentIndices([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 80 },
      ]),
    ).toEqual([]);
  });

  it("a double bend exposes exactly the segment between the two corners", () => {
    // S ─① A ─② B ─③ T  →  only ② (index 1) touches neither endpoint
    expect(
      middleSegmentIndices([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 80 },
        { x: 120, y: 80 },
      ]),
    ).toEqual([1]);
  });

  it("scales to longer chains", () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: 0 }));
    expect(middleSegmentIndices(pts)).toEqual([1, 2, 3]);
  });
});

describe("slideSegment", () => {
  const chain = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 80 },
    { x: 120, y: 80 },
  ];

  it("moves a vertical segment sideways, keeping both corners level", () => {
    const out = slideSegment(chain, 1, { x: 90, y: 40 });

    expect(out[1]).toEqual({ x: 90, y: 0 });
    expect(out[2]).toEqual({ x: 90, y: 80 });
    expect(out[0]).toEqual(chain[0]);
    expect(out[3]).toEqual(chain[3]);
  });

  it("ignores movement along the segment's own direction", () => {
    const out = slideSegment(chain, 1, { x: 50, y: 999 });
    expect(out).toEqual(chain);
  });

  it("keeps the bend count unchanged", () => {
    expect(slideSegment(chain, 1, { x: 90, y: 40 })).toHaveLength(chain.length);
  });

  it("moves a horizontal segment vertically", () => {
    const horizontal = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 100, y: 40 },
      { x: 100, y: 90 },
    ];
    const out = slideSegment(horizontal, 1, { x: 50, y: 70 });

    expect(out[1]).toEqual({ x: 0, y: 70 });
    expect(out[2]).toEqual({ x: 100, y: 70 });
  });

  it("leaves a zero-length segment alone instead of dividing by zero", () => {
    const degenerate = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ];
    expect(slideSegment(degenerate, 1, { x: 99, y: 99 })).toEqual(degenerate);
  });

  it("returns the chain untouched for an out-of-range index", () => {
    expect(slideSegment(chain, 9, { x: 0, y: 0 })).toEqual(chain);
  });
});
