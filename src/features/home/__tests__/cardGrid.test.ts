import { describe, expect, it } from "vitest";

import { columnsOf, gridMove, isGridKey } from "../cardGrid";

/** a folder view's cards as a grid (#231 D7, T16) — the arrows move by place */
describe("card grid navigation (#231 D7, T16)", () => {
  describe("gridMove — 7 cards in 3 columns", () => {
    // 0 1 2
    // 3 4 5
    // 6
    const move = (at: number, key: Parameters<typeof gridMove>[3]) => gridMove(7, 3, at, key);

    it("↓ — the row below in the same column, stays put if that cell is missing", () => {
      expect(move(2, "ArrowDown")).toBe(5);
      expect(move(0, "ArrowDown")).toBe(3);
      expect(move(3, "ArrowDown")).toBe(6);
      expect(move(5, "ArrowDown")).toBe(5);
      expect(move(6, "ArrowDown")).toBe(6);
    });

    it("↑ — the row above in the same column, stays put on the first row", () => {
      expect(move(6, "ArrowUp")).toBe(3);
      expect(move(4, "ArrowUp")).toBe(1);
      expect(move(1, "ArrowUp")).toBe(1);
    });

    it("←→ — previous·next card, wrapping across rows and stopping at the ends", () => {
      expect(move(0, "ArrowLeft")).toBe(0);
      expect(move(6, "ArrowRight")).toBe(6);
      expect(move(2, "ArrowRight")).toBe(3);
      expect(move(3, "ArrowLeft")).toBe(2);
    });

    it("Home·End — first·last", () => {
      expect(move(4, "Home")).toBe(0);
      expect(move(4, "End")).toBe(6);
    });
  });

  it("gridMove — 5 cards in 2 columns", () => {
    // 0 1
    // 2 3
    // 4
    expect(gridMove(5, 2, 1, "ArrowDown")).toBe(3);
    expect(gridMove(5, 2, 3, "ArrowDown")).toBe(3);
    expect(gridMove(5, 2, 2, "ArrowDown")).toBe(4);
    expect(gridMove(5, 2, 4, "ArrowUp")).toBe(2);
    expect(gridMove(5, 2, 1, "ArrowRight")).toBe(2);
    expect(gridMove(5, 2, 4, "End")).toBe(4);
  });

  it("gridMove — a single card, does not break with 0 or fewer columns", () => {
    expect(gridMove(1, 3, 0, "ArrowDown")).toBe(0);
    expect(gridMove(1, 3, 0, "End")).toBe(0);
    expect(gridMove(4, 0, 1, "ArrowDown")).toBe(2);
  });

  it("isGridKey — arrows·Home·End only", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
      expect(isGridKey(key)).toBe(true);
    }
    for (const key of ["Enter", " ", "Escape", "Tab", "PageDown"]) {
      expect(isGridKey(key)).toBe(false);
    }
  });

  describe("columnsOf — the grid-template-columns track count at that moment", () => {
    const grid = (columns: string) => {
      const el = document.createElement("ul");
      el.style.gridTemplateColumns = columns;
      return el;
    };

    it("browser-resolved value (px tracks)", () => {
      expect(columnsOf(grid("336px 336px 336px"))).toBe(3);
      expect(columnsOf(grid("300px 300px"))).toBe(2);
    });

    it("repeat(N, …) and minmax(…)", () => {
      expect(columnsOf(grid("repeat(3, minmax(0, 1fr))"))).toBe(3);
      expect(columnsOf(grid("minmax(0, 1fr) minmax(0, 1fr)"))).toBe(2);
    });

    it("1 when unreadable", () => {
      expect(columnsOf(grid(""))).toBe(1);
      expect(columnsOf(grid("none"))).toBe(1);
      expect(columnsOf(null)).toBe(1);
    });
  });
});
