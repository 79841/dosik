import type { FolderMeta, ItemKey } from "../../library/libraryApi";
import { childKey, childrenOf, isMissing } from "../../library/libraryTree";

/**
 * The library canvas's geometry in board units (#221 D4) — 1 is a CSS pixel
 * at 100%. The yardstick is "at 70% the size of the Hybrid-Home-Canvas
 * board": the design's numbers ÷ 0.7, put on the 4 grid. Text inside the
 * board scales with it; the islands, menus and toasts are screen-sized.
 * Every number lives here, pinned by `boardGeometry.test`.
 */

/** a diagram card or a folder card (#231 D13): a 220×120 well, the name and the meta under it */
export const CARD_W = 240;
export const CARD_H = 192;
export const CARD_PAD = 10;
export const WELL_W = 220;
export const WELL_H = 120;

/** a project frame: dashed, 20 in, a 64 header, cards 20 apart */
export const FRAME_PAD = 20;
export const FRAME_HEAD = 64;
export const CARD_GAP = 20;
/** the widest a frame's grid gets, so a big unfolded project does not run on in one row */
export const MAX_COLS = 5;

/** a project of this many items — folders and diagrams right under it — starts collapsed into a stack (D6, #231 D13) */
export const COLLAPSE_AT = 7;
/** the faces behind a stack's front card — drawn without pictures */
export const STACK_BEHIND = 2;
/** how far each face behind sits from the one before it — no tilt */
export const STACK_STEP = { x: 12, y: 8 } as const;
/** the row under a stack: "{n} items · {d} diagrams", "Latest: …", Expand */
export const STACK_FOOT = 44;
/** room between the stack and its row */
export const STACK_FOOT_GAP = 16;
/** the front card and the faces behind it */
export const STACK_FACES_W = CARD_W + STACK_BEHIND * STACK_STEP.x;
/**
 * A collapsed project's frame (#231 D13): the canvas's stack frame, 240 at
 * 70%, on the 4 grid — wider than the faces, so the row under them
 * ("7 items · 10 diagrams" and Expand) is whole.
 */
export const STACK_FRAME_W = 344;
/** the stack's box: the frame less its padding — the faces at its left, the row across it */
export const STACK_W = STACK_FRAME_W - 2 * FRAME_PAD;
export const STACK_H = CARD_H + STACK_BEHIND * STACK_STEP.y + STACK_FOOT_GAP + STACK_FOOT;

/**
 * An empty project's message (#231 D13, `Hybrid-Home-Canvas`): its frame is
 * as wide as a collapsed one — the canvas draws both 240 at 70% — so the
 * message takes the frame's inside; 56 ÷ 0.7 high.
 */
export const EMPTY_W = STACK_W;
export const EMPTY_H = 80;

/**
 * A project not found (#253 R7, `Library-Missing`): its frame keeps its
 * place at the canvas's 240 × 150 — an empty frame's width — its box ("Can't
 * find this folder", the path, Locate…) 92 ÷ 0.7 high, on the 4 grid.
 */
export const MISSING_H = 132;

/**
 * A folder opened in place (#231 D14): a dashed sub-frame of its items as
 * big cards — `Hybrid-Folder-Canvas` draws its frame cards 180 wide where
 * ours are 240 (`CARD_W`), so every sub-frame number is the canvas's ×
 * 240/180, on the 4 grid: 20 in (14), a 68 header and a 68 footer (50),
 * tiles 324×276 (244×206) 20 apart (14), their wells 300×188 (224×140) 12
 * in (10), four to a row.
 */
export const SUB_PAD = 20;
export const SUB_HEAD = 68;
export const SUB_FOOT = 68;
export const TILE_W = 324;
export const TILE_H = 276;
export const TILE_PAD = 12;
export const TILE_WELL_W = 300;
export const TILE_WELL_H = 188;
export const TILE_GAP = 20;
export const SUB_COLS = 4;

/**
 * A sub-frame's header (`Hybrid-Folder-Canvas`, `Home-States` 6), × 240/180
 * like the rest: + and Collapse are 36×36 icon buttons (28) — the project
 * frame's buttons' size, as the canvas's 28 is within a grid step of its
 * frame's 26 — 4 apart, 12 in from the right; the title box starts 20 in
 * (14), FolderOpen 20 (15) and 10 before the title (8), and stops 12 clear
 * of the buttons (8), so "New folder · 0 items" fits one tile's width.
 */
export const SUB_TOOL = 36;
export const SUB_TOOL_GAP = 4;
export const SUB_TOOL_INSET = 12;
export const SUB_TOOLS_CLEAR = SUB_TOOL_INSET + 2 * SUB_TOOL + SUB_TOOL_GAP + 12;
export const SUB_TITLE_INSET = 20;
export const SUB_TITLE_ICON = 20;
export const SUB_TITLE_ICON_GAP = 10;

/** frames apart when first placed (D8), at the least after settling (D9), and the drop grid (D14) */
export const PLACE_GAP = 80;
export const SETTLE_GAP = 40;
export const ROW_WIDTH = 1600;
export const SNAP = 20;

/** columns for `n` cards (D5): up to three in a row, then about square, at most five */
export const frameColumns = (n: number): number =>
  n <= 3 ? Math.max(n, 1) : Math.min(MAX_COLS, Math.ceil(Math.sqrt(n)));

/**
 * Whether a project of `count` items shows as a stack (D6): its own
 * setting when it has one, else from seven up. Fewer than two never fold —
 * a stack of one is a card.
 */
export const isCollapsed = (count: number, collapsed: boolean | undefined): boolean =>
  count >= 2 && (collapsed ?? count >= COLLAPSE_AT);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What a frame holds, at its place inside the frame — or what an open
 * folder's sub-frame holds, at its place inside the sub-frame. Inside a
 * sub-frame the cards are tile-sized and nothing folds into a stack.
 */
export type FrameItem =
  /** a diagram's card */
  | ({ kind: "card"; id: string } & Box)
  /** a folder's card (#231 D13) — the same box */
  | ({ kind: "folder"; id: string } & Box)
  | ({
      kind: "stack";
      /** the items in the sidebar's order — less a folder opened in place; `front` is `keys[0]` — a folder, maybe */
      keys: ItemKey[];
      front: ItemKey;
      /**
       * the project's items — the number its header shows (#231 D13), an
       * open folder among them, though it is drawn beside the stack
       */
      count: number;
      /** faces drawn behind the front card */
      behind: number;
    } & Box)
  /** a folder opened in place, in its card's place (#231 D14): its items, inside it */
  | ({ kind: "sub"; id: string; items: FrameItem[] } & Box)
  | ({ kind: "empty" } & Box)
  /** a project not found: the box that says so, with Locate… (#253 R7) */
  | ({ kind: "missing" } & Box);

export interface FrameLayout {
  w: number;
  h: number;
  items: FrameItem[];
}

/**
 * Whether frame `layout` draws a stack — "collapsed" as the screen has it
 * (#231 D13): a collapsed project with a folder open beside fewer than two
 * items draws them as cards, its setting still collapsed.
 */
export const drawsStack = (layout: FrameLayout): boolean =>
  layout.items.some((it) => it.kind === "stack");

/**
 * The fold a project's frame `⋯` offers (#231 D13) — one rule: the toggle is
 * hidden when pressing it would not change the drawing. It sets the project
 * the other way from frame `layout` as drawn — Expand over a stack, Collapse
 * over cards — and is offered only when the frame that setting draws differs.
 * Expand always does; Collapse does not under two items, nor beside a folder
 * open in place with fewer than two left to stack, whatever is stored.
 */
export const frameFold = (
  folder: FolderMeta,
  layout: FrameLayout,
): "expand" | "collapse" | null => {
  const stacked = drawsStack(layout);
  // what stacks depends only on the folder open right under the project, the sub-frame here
  const opened = layout.items.flatMap((it) => (it.kind === "sub" ? [it.id] : []));
  if (drawsStack(frameLayout(folder, !stacked, opened)) === stacked) return null;
  return stacked ? "expand" : "collapse";
};

/** an item before the flow gives it a place */
type Sized = FrameItem extends infer T ? (T extends FrameItem ? Omit<T, "x" | "y"> : never) : never;
/** an open folder's sub-frame, sized */
export type SubFrame = Extract<Sized, { kind: "sub" }>;

/** where a flow starts in its box, and the room between its items */
interface Spacing {
  left: number;
  top: number;
  gap: number;
}

/**
 * One flow for every frame and sub-frame (D5): left to right in list order,
 * a new row when the next would pass `inner`; a row is as tall as its
 * tallest. An open folder's sub-frame takes a row of its own (#221 D11,
 * #231 Q1): the items before it stay above, the rest go on below. Returns
 * the items placed and how tall the rows are together.
 */
const flow = (
  sized: readonly Sized[],
  inner: number,
  { left, top, gap }: Spacing,
): { items: FrameItem[]; h: number } => {
  const items: FrameItem[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let breakAfter = false;
  for (const item of sized) {
    const own = item.kind === "sub";
    if (x > 0 && (own || breakAfter || x + item.w > inner)) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    items.push({ ...item, x: left + x, y: top + y } as FrameItem);
    x += item.w + gap;
    rowH = Math.max(rowH, item.h);
    breakAfter = own;
  }
  return { items, h: y + rowH };
};

/** a project frame's flow: 20 in, under the 64 header, 20 to its bottom */
const frameFlow = (sized: readonly Sized[], inner: number): FrameLayout => {
  const { items, h } = flow(sized, inner, { left: FRAME_PAD, top: FRAME_HEAD, gap: CARD_GAP });
  return { items, w: 2 * FRAME_PAD + inner, h: FRAME_HEAD + h + FRAME_PAD };
};

/**
 * Folder `folder` opened in place (#231 D14): its items in the sidebar's
 * order as folder and diagram tiles, four to a row — the next folder of
 * `chain` opened in its tile's place, a sub-frame of its own on a row of its
 * own, and so on down the chain. An empty folder keeps one tile's room for
 * its message. Positions are inside the sub-frame.
 */
export const subFrameLayout = (folder: FolderMeta, chain: readonly string[]): SubFrame => {
  const children = childrenOf(folder);
  if (children.length === 0) {
    return {
      kind: "sub",
      id: folder.id,
      items: [{ kind: "empty", x: SUB_PAD, y: SUB_HEAD, w: TILE_W, h: TILE_H }],
      w: 2 * SUB_PAD + TILE_W,
      h: SUB_HEAD + TILE_H + SUB_FOOT,
    };
  }
  const [next, ...rest] = chain;
  const sized = children.map(
    (c): Sized =>
      c.kind === "diagram"
        ? { kind: "card", id: c.diagram.id, w: TILE_W, h: TILE_H }
        : c.folder.id === next
          ? subFrameLayout(c.folder, rest)
          : { kind: "folder", id: c.folder.id, w: TILE_W, h: TILE_H },
  );
  const cols = Math.min(children.length, SUB_COLS);
  const inner = Math.max(cols * TILE_W + (cols - 1) * TILE_GAP, ...sized.map((s) => s.w));
  const { items, h } = flow(sized, inner, { left: SUB_PAD, top: SUB_HEAD, gap: TILE_GAP });
  return {
    kind: "sub",
    id: folder.id,
    items,
    w: 2 * SUB_PAD + inner,
    h: SUB_HEAD + h + SUB_FOOT,
  };
};

/**
 * What a project's frame holds and how big it is (D4–D6, #231 D13): the
 * items right under it in the sidebar's order (`childrenOf`, #230) — folder
 * cards and diagram cards — or the stack they fold into; what is inside a
 * folder stays in its folder. `chain` is the folders opened in place below
 * the project, outermost first (#231 D14): its first, when it is one of the
 * project's folders, takes its card's place as a sub-frame on a row of its
 * own — a collapsed project keeps the rest stacked after it, or as cards
 * when fewer than two are left (no stack of one). A project not found
 * holds its box alone (#253 R7). Positions are inside the frame.
 */
export const frameLayout = (
  folder: FolderMeta,
  collapsed: boolean | undefined,
  chain: readonly string[] = [],
): FrameLayout => {
  if (isMissing(folder)) {
    return frameFlow([{ kind: "missing", w: EMPTY_W, h: MISSING_H }], EMPTY_W);
  }
  const children = childrenOf(folder);
  if (children.length === 0) {
    return frameFlow([{ kind: "empty", w: EMPTY_W, h: EMPTY_H }], EMPTY_W);
  }
  const [first, ...rest] = chain;
  const opened = children.find((c) => c.kind === "folder" && c.folder.id === first);
  const sub = opened?.kind === "folder" ? subFrameLayout(opened.folder, rest) : null;
  const keys = children.filter((c) => c !== opened).map(childKey);
  // what is left beside an open folder stacks only while two are left — one is a card
  if (isCollapsed(children.length, collapsed) && keys.length >= 2) {
    const stack: Sized = {
      kind: "stack",
      keys,
      front: keys[0]!,
      count: children.length,
      behind: Math.min(keys.length - 1, STACK_BEHIND),
      w: STACK_W,
      h: STACK_H,
    };
    const sized = sub ? [sub, stack] : [stack];
    return frameFlow(sized, Math.max(...sized.map((s) => s.w)));
  }
  const sized = children.map(
    (c): Sized =>
      c === opened && sub
        ? sub
        : c.kind === "folder"
          ? { kind: "folder", id: c.folder.id, w: CARD_W, h: CARD_H }
          : { kind: "card", id: c.diagram.id, w: CARD_W, h: CARD_H },
  );
  const cols = frameColumns(children.length);
  return frameFlow(
    sized,
    Math.max(cols * CARD_W + (cols - 1) * CARD_GAP, ...sized.map((s) => s.w)),
  );
};
