import type { RefObject } from "react";

import { useAppStore } from "../../library/appStore";
import { THUMB_MIN_ZOOM, DEFAULT_ZOOM } from "./boardViewport";
import { type BoardMenu, useBoardStore } from "./boardStore";

/**
 * Small pieces the board's parts share (#221): the dashed outline of a
 * frame, a "zoomed too far out to draw" flag, and how a move inside the
 * board changes Home's view — without sending focus to a heading (D2).
 */

/**
 * A dashed rounded outline in board units (D4: 1.75 wide, 7 on 6 off,
 * radius 12) — CSS dashes cannot be set that finely. No ids inside, so no
 * clash between many of them (D19 ⑦).
 */
export const DashedOutline = ({
  w,
  h,
  className,
}: {
  w: number;
  h: number;
  /** the stroke (and fill) colour, as token utilities */
  className: string;
}) => (
  <svg
    aria-hidden="true"
    width={w}
    height={h}
    className="pointer-events-none absolute top-0 left-0 overflow-visible"
  >
    <rect
      x={0.875}
      y={0.875}
      width={Math.max(0, w - 1.75)}
      height={Math.max(0, h - 1.75)}
      rx={12}
      strokeWidth={1.75}
      strokeDasharray="7 6"
      className={className}
    />
  </svg>
);

/**
 * While a drag is on, a wheel pan or a pinch moves the board under a pointer
 * that stays still — no pointermove comes. `redo` runs on each camera move
 * so what is dragged, and where it would land, keep up (#221).
 * Returns the function that stops it.
 */
export const followCamera = (redo: () => void): (() => void) =>
  useBoardStore.subscribe((now, before) => {
    if (now.viewport !== before.viewport) redo();
  });

/** below 40% the board asks for no new picture (D19 ②) */
export const useDeferPictures = (): boolean =>
  useBoardStore((s) => (s.viewport?.zoom ?? DEFAULT_ZOOM) < THUMB_MIN_ZOOM);

/**
 * A folder in focus (D12, #231 D13, D14) — a project's frame, or a folder's
 * card, which opens in place. A move inside the board: no heading takes the
 * focus (D2).
 */
export const focusFolder = (folder: string): void =>
  useAppStore.getState().setHomeView({ kind: "folder", folder });

/**
 * A frame header's + or ⋯ pressed (#231 D9, D13): its menu opens — or,
 * pressed again, the menu it opened closes (#220)
 */
export const toggleMenu = (
  menu: Extract<BoardMenu, { kind: "project" | "new" }> & {
    opener: RefObject<HTMLElement | null>;
  },
): void => {
  const board = useBoardStore.getState();
  if (board.menu && "opener" in board.menu && board.menu.opener === menu.opener) {
    board.closeMenu();
  } else {
    board.openMenu(menu);
  }
};

/** Shift+F10 or the context-menu key: the keyboard's right-click (D20) */
export const isMenuKey = (e: React.KeyboardEvent): boolean =>
  (e.key === "F10" && e.shiftKey) || e.key === "ContextMenu";

/** where a menu opened from the keyboard goes: under the item */
export const belowOf = (el: Element): { x: number; y: number } => {
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.bottom + 4 };
};

/**
 * The board's boxes never scroll (#221): the camera is the only
 * way the board moves, and a scroll offset would skew every point it maps.
 * `overflow: clip` keeps a focused item from scrolling them, but WebKit has
 * it only from 16 — before that they fall back to `overflow-hidden`, a box
 * that still scrolls to show a focus, so any such offset goes back to 0 at
 * once (#221). The fallback keeps that scroll inside the board,
 * where this can undo it, rather than in the sheet around it.
 */
export const NO_SCROLL = "overflow-hidden supports-[overflow:clip]:overflow-clip";

/** `onScroll` of a box in `NO_SCROLL`: whatever scrolled it, back to 0 */
export const unscroll = (e: React.UIEvent<HTMLElement>): void => {
  const el = e.currentTarget;
  if (el.scrollLeft !== 0) el.scrollLeft = 0;
  if (el.scrollTop !== 0) el.scrollTop = 0;
};

/** a lifted card's look: up 6 and the lifted shadow on hover or focus (D4) */
export const LIFT =
  "hover:-translate-y-1.5 hover:shadow-lifted focus-within:-translate-y-1.5 focus-within:shadow-lifted";

/**
 * A card's box (D4, #231 D13 — a diagram's and a folder's alike): 240×192,
 * radius 12, 10 in; lifted on hover or focus, and while it is dragged — not
 * while its name is being edited (`naming`), when it rests though the focus
 * is inside it (`Home-States` 5). A `tile` — a card in an open folder's
 * sub-frame (#231 D14) — is the big card: 324×276, 12 in (`TILE_W`,
 * `TILE_H`, `TILE_PAD`).
 */
export const cardBox = (dragging: boolean, tile = false, naming = false): string =>
  `group/card absolute ${tile ? "h-[276px] w-[324px] p-3" : "h-[192px] w-[240px] p-[10px]"} rounded-[12px] bg-surface ${
    dragging
      ? "z-20 cursor-grabbing shadow-lifted"
      : `shadow-raised ${naming ? "" : LIFT} motion-safe:transition-[translate,box-shadow,transform] motion-safe:duration-160`
  }`;

/** a card's well: 220×120 — a tile's 300×188 (`TILE_WELL_W`, `TILE_WELL_H`) */
export const wellSize = (tile = false): string =>
  tile ? "h-[188px] w-[300px]" : "h-[120px] w-[220px]";

/**
 * a card's name line, under the well (D4) — a tile's is the canvas's 12 under
 * a 12px name × 240/180 (#231 D14)
 */
export const nameLine = (tile = false): string =>
  `block truncate px-1 text-[16px] font-semibold text-ink ${tile ? "mt-4 leading-6" : "mt-[10px] leading-5"}`;

/** a card's meta line (`Edited …`, `N items`) — a tile's 11px is 15 (#231 D14) */
export const metaLine = (tile = false): string =>
  `mt-1 flex min-w-0 items-center px-1 text-muted ${tile ? "h-5 text-[15px] leading-5" : "h-[22px] text-[14px] leading-[18px]"}`;

/** the Open pill's look, wherever it sits: on hover or with focus in the card */
const PILL =
  "pointer-events-none absolute flex h-[34px] items-center gap-1.5 rounded-full bg-ink pr-3.5 pl-3 text-[15px] font-semibold text-surface opacity-0 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 motion-safe:transition-opacity";

/** a card's Open pill (#229 D18, #231 D13 `Home-States` 5): top right */
export const OPEN_PILL = `${PILL} top-4 right-4`;

/**
 * a tile's Open pill (#231 D14, `Hybrid-Folder-Canvas`): across the middle
 * at the canvas's 116 × 240/180 — 10 above the bottom of the 188 well. Its
 * 34 height, 12/14 sides and 15px are the canvas's 26, 9/11 and 11px ×
 * 240/180 already, the card's pill too.
 */
export const TILE_OPEN_PILL = `${PILL} top-[156px] left-1/2 -translate-x-1/2`;
