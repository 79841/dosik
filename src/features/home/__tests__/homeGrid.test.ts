import { describe, expect, it } from "vitest";

import { DESIGN_TOKENS } from "../../../test/designTokens";
import { RECENT_ON_DASHBOARD } from "../homeModel";
import {
  CARD_MIN,
  CARD_SIZES,
  type CardSize,
  cardGrid,
  COLUMNS,
  CONTENT_MAX,
  CONTENT_MAX_WIDE,
  CONTINUE_SPAN,
  contentColumn,
  DEFAULT_CARD_SIZE,
  GUTTER,
  RECENT_WIDE_AT,
  recentShowClass,
  START_GRID,
  START_SPAN,
} from "../homeGrid";

const layout = (name: string) => DESIGN_TOKENS.layout.tokens.find((t) => t.name === name)?.value;

describe("Home 12-column grid (#220 D12, T18)", () => {
  it("the constants match layout in tokens.json", () => {
    expect(`${CONTENT_MAX}px`).toBe(layout("content-max"));
    expect(`${CONTENT_MAX_WIDE}px`).toBe(layout("content-max-wide"));
    expect(`${GUTTER}px`).toBe(layout("grid-gutter"));
    expect(String(COLUMNS)).toBe(layout("grid-columns"));
    // 12 columns and 11 gutters fill the content width exactly
    expect(12 * Number.parseInt(layout("grid-column")!, 10) + 11 * GUTTER).toBe(CONTENT_MAX);
    expect(12 * Number.parseInt(layout("grid-column-wide")!, 10) + 11 * GUTTER).toBe(
      CONTENT_MAX_WIDE,
    );
  });

  it("content column — 1040 with the sidebar shown, 1232 hidden, from the left (not centered, #231 D21), container", () => {
    expect(contentColumn(false)).toContain(`max-w-[${CONTENT_MAX}px]`);
    expect(contentColumn(true)).toContain(`max-w-[${CONTENT_MAX_WIDE}px]`);
    // the cap eases with the sidebar's slide, and only then (canvas TabsCollapse-Toggle)
    for (const hidden of [false, true]) {
      expect(contentColumn(hidden)).not.toContain("transition");
      expect(contentColumn(hidden, true)).toContain("motion-safe:transition-[max-width]");
      expect(contentColumn(hidden, true)).toContain("motion-safe:duration-200");
    }
    for (const hidden of [false, true]) {
      // spare room in a wide window goes to the right — no auto margin on the left or both sides
      expect(contentColumn(hidden)).not.toMatch(/\b(mx|ml|ms)-auto\b/);
      expect(contentColumn(hidden)).toContain("@container");
    }
  });

  it("spans 2·12 — START is 12/span cells, gaps are gutters", () => {
    expect([START_SPAN, CONTINUE_SPAN]).toEqual([2, 12]);
    expect(START_GRID).toContain(`@min-[752px]:grid-cols-${COLUMNS / START_SPAN}`);
    expect(START_GRID).toContain("gap-4");
  });

  it("START has 3 below 752 (by content width)", () => {
    expect(START_GRID.split(" ")).toContain("grid-cols-3");
  });
});

/**
 * The card grids (#236 D5): the class's own numbers, run the way a browser
 * fills `repeat(auto-fill, minmax(min(100%, N), 1fr))` — as many tracks of at
 * least N as fit with the gutters between, one track of the whole width when
 * not even one does.
 */
const tracks = (grid: string, width: number): { count: number; card: number } => {
  const m = /grid-cols-\[repeat\(auto-fill,minmax\(min\(100%,(\d+)px\),1fr\)\)\]/.exec(grid);
  if (!m) throw new Error(`not a card grid: ${grid}`);
  const min = Math.min(width, Number(m[1]));
  const count = Math.max(1, Math.floor((width + GUTTER) / (min + GUTTER)));
  return { count, card: (width - (count - 1) * GUTTER) / count };
};

/** the width a container query class asks for: `@min-[Npx]:` */
const atLeast = (cls: string): number | null => {
  const m = /@min-\[(\d+)px\]:block/.exec(cls);
  return m ? Number(m[1]) : null;
};

describe("card size grid (#236 R5, T13)", () => {
  it("Small·Medium·Large have min widths 240·300·460, Medium if never chosen", () => {
    expect(CARD_SIZES).toEqual(["small", "medium", "large"]);
    expect(CARD_SIZES.map((size) => CARD_MIN[size])).toEqual([240, 300, 460]);
    expect(DEFAULT_CARD_SIZE).toBe("medium");
  });

  it("one grid class per size — auto-fill, minmax(min(100%, min width), 1fr), gap 16", () => {
    for (const size of CARD_SIZES) {
      const grid = cardGrid(size);
      expect(grid.split(" ")).toEqual(
        expect.arrayContaining([
          "grid",
          "gap-4",
          `grid-cols-[repeat(auto-fill,minmax(min(100%,${CARD_MIN[size]}px),1fr))]`,
        ]),
      );
    }
  });

  it("at 1040, Small 4 columns·Medium 3·Large 2, and 4·3·2 at 1232 too", () => {
    const at = (width: number) => CARD_SIZES.map((size) => tracks(cardGrid(size), width).count);
    expect(at(CONTENT_MAX)).toEqual([4, 3, 2]);
    expect(at(CONTENT_MAX_WIDE)).toEqual([4, 3, 2]);
    // Medium at 1040 is the folder view's old card, 336 (#220 D11); 400 with the sidebar hidden
    expect(tracks(cardGrid("medium"), CONTENT_MAX).card).toBe(336);
    expect(tracks(cardGrid("medium"), CONTENT_MAX_WIDE).card).toBe(400);
  });

  it("cards never get narrower than the min width — as many columns as fit, one column takes the full width in a narrow window", () => {
    for (const size of CARD_SIZES) {
      for (let width = 200; width <= 1400; width += 7) {
        const { count, card } = tracks(cardGrid(size), width);
        if (width >= CARD_MIN[size])
          expect(card, `${size} at ${width}`).toBeGreaterThanOrEqual(CARD_MIN[size]);
        else expect([count, card], `${size} at ${width}`).toEqual([1, width]);
        // one more would not fit
        expect(
          (count + 1) * CARD_MIN[size] + count * GUTTER,
          `${size} at ${width}`,
        ).toBeGreaterThan(width);
      }
    }
  });
});

describe("dashboard RECENT row — a single row (#236 R5·R7, T13)", () => {
  it("the first card always shows, the nth card shows from the content width where the grid makes n columns", () => {
    for (const size of CARD_SIZES) {
      expect(recentShowClass(size, 0)).toBe("");
      for (let i = 1; i < RECENT_ON_DASHBOARD; i++) {
        const cls = recentShowClass(size, i);
        expect(cls.split(" ")[0], `${size} ${i}`).toBe("hidden");
        // the content column is the container (`contentColumn`), the row as wide as it
        const from = atLeast(cls)!;
        expect(from, `${size} ${i}`).toBe((i + 1) * (CARD_MIN[size] + GUTTER) - GUTTER);
        expect(tracks(cardGrid(size), from).count, `${size} ${i} at ${from}`).toBe(i + 1);
        expect(tracks(cardGrid(size), from - 1).count, `${size} ${i} at ${from - 1}`).toBe(i);
      }
    }
  });

  it("always hidden from the fifth on — the dashboard draws up to four", () => {
    for (const size of CARD_SIZES)
      expect(recentShowClass(size, RECENT_ON_DASHBOARD)).toBe("hidden");
  });

  it("the visible count equals the grid column count — the row is full and never overflows anywhere in 300–1400", () => {
    for (const size of CARD_SIZES) {
      for (let width = 300; width <= 1400; width += 5) {
        const shown = Array.from({ length: RECENT_ON_DASHBOARD }, (_, i) => {
          const from = atLeast(recentShowClass(size, i));
          return from === null || width >= from;
        }).filter(Boolean).length;
        expect(shown, `${size} at ${width}`).toBe(
          Math.min(RECENT_ON_DASHBOARD, tracks(cardGrid(size), width).count),
        );
      }
    }
  });

  it("with the default Medium, 3 cards at 1040 and 3 at 1232 — Small 4·4, Large 2·2", () => {
    const shown = (size: CardSize, width: number) =>
      Array.from({ length: RECENT_ON_DASHBOARD }, (_, i) =>
        atLeast(recentShowClass(size, i)),
      ).filter((from) => from === null || width >= from).length;
    expect(CARD_SIZES.map((size) => shown(size, CONTENT_MAX))).toEqual([4, 3, 2]);
    expect(CARD_SIZES.map((size) => shown(size, CONTENT_MAX_WIDE))).toEqual([4, 3, 2]);
  });
});

describe("wide shape of RECENT cards (#231 D10, #236)", () => {
  it("the threshold sits between the two grid card widths at the default size — Main (336) with the sidebar shown, wide shape (400) hidden", () => {
    const shown = tracks(cardGrid(DEFAULT_CARD_SIZE), CONTENT_MAX).card;
    const hidden = tracks(cardGrid(DEFAULT_CARD_SIZE), CONTENT_MAX_WIDE).card;
    expect([shown, hidden]).toEqual([336, 400]);
    expect(shown).toBeLessThan(RECENT_WIDE_AT);
    expect(RECENT_WIDE_AT).toBeLessThanOrEqual(hidden);
    expect(RECENT_WIDE_AT).toBe((shown + hidden) / 2);
  });
});
