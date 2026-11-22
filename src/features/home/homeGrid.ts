import { SLIDE_TIMING } from "../../shared/lib/sidebarSlide";

/**
 * Home's 12-column grid (#220 D12, design-system `layout-and-grid.md`): 72px
 * columns (88 with the sidebar hidden) and 16px gutters make 1040 (1232),
 * starting at the sheet's left edge inside its 32px padding — never centred
 * (#231 D21): a wider window leaves the free space on the
 * right. START's tiles land on the columns; the card grids fit cards of the
 * size picked (#236 D5) with the gutter between. The numbers are tied to
 * `tokens.json`'s `layout` by a test.
 *
 * What narrows the content is the sidebar's width as much as the window's,
 * so the rows that change do so by the content's own width — a container
 * query on the column, or the grid's own `auto-fill` — never by the window's.
 */
export const COLUMNS = 12;
export const GUTTER = 16;
export const CONTENT_MAX = 1040;
export const CONTENT_MAX_WIDE = 1232;

/** spans: a start tile 2 columns, Continue all 12 */
export const START_SPAN = 2;
export const CONTINUE_SPAN = 12;

/**
 * The content column: the wide grid while the sidebar is hidden — peeking
 * included, since the peek moves nothing (#217 D16). While the sidebar slides
 * out or in, its cap eases with it (canvas TabsCollapse-Toggle). Tailwind
 * needs the classes spelled out whole.
 */
export const contentColumn = (sidebarHidden: boolean, sliding = false): string =>
  `@container w-full ${sidebarHidden ? "max-w-[1232px]" : "max-w-[1040px]"}${
    sliding ? ` motion-safe:transition-[max-width] ${SLIDE_TIMING}` : ""
  }`;

/** six across; under 752px of content, where "Blank diagram" would be cut, three in two rows */
export const START_GRID = "grid grid-cols-3 gap-4 @min-[752px]:grid-cols-6";

/** the card sizes, as the size menu offers them (#236 D5) */
export const CARD_SIZES = ["small", "medium", "large"] as const;
export type CardSize = (typeof CARD_SIZES)[number];
/** until one is picked: three across at 1040 — a folder view's old 336 card */
export const DEFAULT_CARD_SIZE: CardSize = "medium";
/** a size is a card's least width (#236 D5) */
export const CARD_MIN: Record<CardSize, number> = { small: 240, medium: 300, large: 460 };

/**
 * Every card grid — the dashboard's RECENT row, a folder view, Recent —
 * fits as many cards of at least the size's width as the content holds, and
 * the cards share what is left (#236 D5): Small four across at 1040 and
 * 1232, Medium three, Large two. No measuring: the browser counts. A content
 * narrower than one card gives that one card all of it. Tailwind needs each
 * class spelled out whole.
 */
const CARD_GRID: Record<CardSize, string> = {
  small: "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))]",
  medium: "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]",
  large: "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,460px),1fr))]",
};

export const cardGrid = (size: CardSize): string => CARD_GRID[size];

/**
 * The dashboard's RECENT row is one row (#236 D7): its i-th card (from 0)
 * shows from the content width at which the grid lays out i + 1 tracks —
 * (i + 1) × (least width + 16) − 16 — so what would wrap to a second row is
 * not drawn (nor a Tab stop). The content column is the container
 * (`contentColumn`) and the row is as wide as it. Tailwind needs each class
 * spelled out whole; a test ties them to `CARD_MIN`.
 */
const RECENT_SHOWN: Record<CardSize, readonly string[]> = {
  small: [
    "",
    "hidden @min-[496px]:block",
    "hidden @min-[752px]:block",
    "hidden @min-[1008px]:block",
  ],
  medium: [
    "",
    "hidden @min-[616px]:block",
    "hidden @min-[932px]:block",
    "hidden @min-[1248px]:block",
  ],
  large: [
    "",
    "hidden @min-[936px]:block",
    "hidden @min-[1412px]:block",
    "hidden @min-[1888px]:block",
  ],
};

/** the classes the dashboard row's `index`-th card (from 0) takes at `size` */
export const recentShowClass = (size: CardSize, index: number): string =>
  RECENT_SHOWN[size][index] ?? "hidden";

/**
 * From this many px of its own width a recent card takes its wide shape
 * (#231 D10, `HomeCollapse-Hidden`): halfway between the default size's card
 * with the sidebar shown (336, `Main`) and hidden (400). `RecentCard` spells
 * it out whole in its `@min-[368px]:` classes, as Tailwind needs.
 */
export const RECENT_WIDE_AT = 368;
