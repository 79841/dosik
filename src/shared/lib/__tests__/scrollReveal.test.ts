import { describe, expect, it } from "vitest";

import { revealScroll, scrollFade } from "../scrollReveal";

describe("scroll into view (#218 D13 T14, #219 D7)", () => {
  // the view is 400 wide; Home (36 + 2) stays pinned over its left edge
  it("leaves it alone when already inside", () => {
    expect(revealScroll(100, 400, 200, 112, 38)).toBe(100);
  });

  it("when off to the left, brings it just past the pinned leading part", () => {
    expect(revealScroll(300, 400, 260, 112, 38)).toBe(222);
    expect(revealScroll(50, 400, 38, 112, 38)).toBe(0);
  });

  it("when off to the right, aligns it to the right edge", () => {
    expect(revealScroll(0, 400, 600, 112, 38)).toBe(312);
  });

  it("aligns to the left edge when there is no pinned leading part (page tabs)", () => {
    expect(revealScroll(300, 400, 120, 80)).toBe(120);
    expect(revealScroll(0, 300, 500, 80)).toBe(280);
  });
});

describe("fading the hidden ends (#218 D13, #219 D7)", () => {
  it("has none when nothing overflows", () => {
    expect(scrollFade(false, 0, 300, 300)).toBe("none");
  });

  it("right only at the start, left only at the end, both in between", () => {
    expect(scrollFade(true, 0, 300, 600)).toBe("right");
    expect(scrollFade(true, 300, 300, 600)).toBe("left");
    expect(scrollFade(true, 100, 300, 600)).toBe("both");
  });

  it("a rounding 1px short of the end counts as the end", () => {
    expect(scrollFade(true, 299.5, 300, 600)).toBe("left");
  });
});
