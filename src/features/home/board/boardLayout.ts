import type { BoardSpot, FolderMeta, ItemKey } from "../../library/libraryApi";
import { canPlace, findFolder } from "../../library/libraryTree";
import {
  EMPTY_H,
  EMPTY_W,
  FRAME_HEAD,
  FRAME_PAD,
  type FrameItem,
  type FrameLayout,
  frameLayout,
  PLACE_GAP,
  ROW_WIDTH,
  SETTLE_GAP,
} from "./boardGeometry";

/**
 * Where the library's frames go (#221 D7–D9, D11, D13, D15). Pure: the
 * listing and what this session has written in, the frames out. The board
 * draws `renderLayout(persistentLayout(…), viewed)`; the commit writes the
 * difference between `persistentLayout` and what is stored, so what is
 * stored never overlaps, a folder opened in place never moves a stored
 * place, and drawing it again changes nothing.
 */

export interface FrameRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** a project's place as far as it is known — `x`/`y` unset is a frame not placed yet */
export type BoardEntry = Partial<BoardSpot>;

export interface LayoutFrame extends FrameRect {
  folder: FolderMeta;
  /** what the frame holds, positions inside it */
  layout: FrameLayout;
  /** its own collapse setting, if it has one (D6) */
  collapsed: boolean | undefined;
  /** whether its place is stored (D8) */
  pinned: boolean;
}

export interface BoardLayout {
  /** in list order */
  frames: LayoutFrame[];
  byId: Map<string, LayoutFrame>;
}

export const isPlaced = (entry: BoardEntry | undefined): entry is BoardSpot =>
  entry?.x !== undefined && entry.y !== undefined;

/**
 * Each project's place as the board should take it: the listing's `board`,
 * then what this session sent and the listing has not caught up with
 * (`overlay`, whole spots — a write replaces the board whole), then the
 * change an action is about to make (`overrides`, merged).
 */
export const effectiveBoards = (
  folders: FolderMeta[],
  overlay: Readonly<Record<string, BoardSpot>>,
  overrides: Readonly<Record<string, BoardEntry>> = {},
): Map<string, BoardEntry> => {
  const out = new Map<string, BoardEntry>();
  for (const folder of folders) {
    const base: BoardEntry | undefined = overlay[folder.id] ?? folder.board;
    const over = overrides[folder.id];
    const entry = over ? { ...base, ...over } : base;
    if (entry) out.set(folder.id, entry);
  }
  return out;
};

/** the box around `rects`, or `null` for none */
export const boardBounds = (
  rects: readonly { x: number; y: number; w: number; h: number }[],
): { x: number; y: number; w: number; h: number } | null => {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
};

/**
 * Places frames that have no place yet (D8): rows of `ROW_WIDTH` (or the
 * placed frames' width, if wider) from the origin — or, when some frames
 * are placed, from 80 below all of them, so nothing placed moves.
 */
export const autoPlace = (
  sizes: readonly { id: string; w: number; h: number }[],
  placed: readonly FrameRect[],
): FrameRect[] => {
  const box = boardBounds(placed);
  const left = box?.x ?? 0;
  const width = Math.max(ROW_WIDTH, box?.w ?? 0);
  let x = left;
  let y = box ? box.y + box.h + PLACE_GAP : 0;
  let rowH = 0;
  return sizes.map(({ id, w, h }) => {
    if (x > left && x + w > left + width) {
      x = left;
      y += rowH + PLACE_GAP;
      rowH = 0;
    }
    const frame = { id, x, y, w, h };
    x += w + PLACE_GAP;
    rowH = Math.max(rowH, h);
    return frame;
  });
};

const tooClose = (a: FrameRect, b: FrameRect): boolean =>
  a.x < b.x + b.w + SETTLE_GAP &&
  b.x < a.x + a.w + SETTLE_GAP &&
  a.y < b.y + b.h + SETTLE_GAP &&
  b.y < a.y + a.h + SETTLE_GAP;

export interface SettleHint {
  /** settled before every other — it keeps its place; the rest make room */
  first?: string;
  /** settled after every other — it makes room; the rest keep theirs */
  last?: string;
  /** pushes allowed per frame before it goes below everything (a test seam) */
  limit?: number;
}

/**
 * Moves frames apart until each is 40 from every other (D9). One at a time —
 * `first`, then the rest by their place (y, x, id), then `last` — each is
 * pushed off the frames already settled: right or down, whichever is
 * shorter, down on a tie. Frames only move right and down, past each settled
 * frame at most once, so it ends; past `limit` pushes a frame goes below
 * everything. Returns the frames in the order given.
 */
export const settleFrames = <T extends FrameRect>(
  frames: readonly T[],
  { first, last, limit = Number.POSITIVE_INFINITY }: SettleHint = {},
): T[] => {
  const rank = (f: FrameRect) => (f.id === first ? 0 : f.id === last ? 2 : 1);
  const order = [...frames].sort(
    (a, b) =>
      rank(a) - rank(b) || a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const placed: T[] = [];
  for (const frame of order) {
    let at: T = frame;
    let pushes = 0;
    for (;;) {
      const hit = placed.find((p) => tooClose(at, p));
      if (!hit) break;
      if (pushes >= limit || pushes > placed.length) {
        const bottom = Math.max(...placed.map((p) => p.y + p.h));
        at = { ...at, y: bottom + SETTLE_GAP };
        break;
      }
      pushes += 1;
      const right = hit.x + hit.w + SETTLE_GAP - at.x;
      const down = hit.y + hit.h + SETTLE_GAP - at.y;
      at = right < down ? { ...at, x: at.x + right } : { ...at, y: at.y + down };
    }
    placed.push(at);
  }
  const byId = new Map(placed.map((f) => [f.id, f]));
  return frames.map((f) => byId.get(f.id) ?? f);
};

const indexed = (frames: LayoutFrame[]): BoardLayout => ({
  frames,
  byId: new Map(frames.map((f) => [f.id, f])),
});

/**
 * The board as it is kept (D8, D9): stored places, frames with none placed
 * below them, then settled. What the
 * commit writes; `hint` says whose place wins. A frame's `folder` is the
 * project as listed: it holds the items right under it (#231 D13).
 */
export const persistentLayout = (
  folders: FolderMeta[],
  boards: ReadonlyMap<string, BoardEntry>,
  hint: SettleHint,
): BoardLayout => {
  const sized = folders.map((folder) => {
    const entry = boards.get(folder.id);
    const layout = frameLayout(folder, entry?.collapsed);
    return { folder, entry, layout, id: folder.id, w: layout.w, h: layout.h };
  });
  const pinned: FrameRect[] = [];
  for (const s of sized) {
    if (isPlaced(s.entry)) {
      pinned.push({ id: s.id, x: s.entry.x, y: s.entry.y, w: s.w, h: s.h });
    }
  }
  const fresh = autoPlace(
    sized.filter((s) => !isPlaced(s.entry)),
    pinned,
  );
  const rects = new Map([...pinned, ...fresh].map((r) => [r.id, r]));
  const frames: LayoutFrame[] = sized.map((s) => {
    const r = rects.get(s.id) ?? { id: s.id, x: 0, y: 0, w: s.w, h: s.h };
    return {
      ...r,
      folder: s.folder,
      layout: s.layout,
      collapsed: s.entry?.collapsed,
      pinned: isPlaced(s.entry),
    };
  });
  return indexed(settleFrames(frames, hint));
};

/**
 * The board as drawn (#221 D11, #231 D14): the kept layout, with the folder
 * `viewed` — when it is below a project — opened in place, and every folder
 * between the project and it: that project's frame grows where it is and
 * its neighbours make room for now. Nothing here is written; with no folder
 * below a project in view it is the kept layout itself.
 */
export const renderLayout = (persistent: BoardLayout, viewed: string | null): BoardLayout => {
  if (viewed === null) return persistent;
  const path = findFolder(
    persistent.frames.map((f) => f.folder),
    viewed,
  )?.path;
  const home = path && path.length > 1 ? persistent.byId.get(path[0]!.id) : undefined;
  if (!path || !home) return persistent;
  const layout = frameLayout(
    home.folder,
    home.collapsed,
    path.slice(1).map((f) => f.id),
  );
  const frames = persistent.frames.map((f) =>
    f === home ? { ...f, layout, w: layout.w, h: layout.h } : f,
  );
  return indexed(settleFrames(frames, { first: home.id }));
};

/**
 * What to write so the store matches `layout` (D9): every project but one
 * whose write failed this session, whose place — or collapse
 * setting — differs from `stored`. `collapsed` rides along only where
 * `boards` sets it.
 */
export const planCommit = (
  layout: BoardLayout,
  boards: ReadonlyMap<string, BoardEntry>,
  stored: ReadonlyMap<string, BoardEntry>,
  failed: ReadonlySet<string>,
): { id: string; board: BoardSpot }[] =>
  layout.frames.flatMap((frame) => {
    if (failed.has(frame.id)) return [];
    const collapsed = boards.get(frame.id)?.collapsed;
    const board: BoardSpot = {
      x: frame.x,
      y: frame.y,
      ...(collapsed !== undefined ? { collapsed } : {}),
    };
    const was = stored.get(frame.id);
    const same =
      isPlaced(was) && was.x === board.x && was.y === board.y && was.collapsed === collapsed;
    return same ? [] : [{ id: frame.id, board }];
  });

/** the frame whose box holds board point `p` — the topmost, the last drawn */
export const frameAtPoint = (
  layout: BoardLayout,
  p: { x: number; y: number },
): LayoutFrame | null => {
  for (let i = layout.frames.length - 1; i >= 0; i -= 1) {
    const f = layout.frames[i]!;
    if (p.x >= f.x && p.x < f.x + f.w && p.y >= f.y && p.y < f.y + f.h) return f;
  }
  return null;
};

/** a folder opened in place on the drawn board (#231 D14): its sub-frame's box, in board units */
export interface OpenFrame extends FrameRect {
  /** the project whose frame holds it */
  project: string;
}

/** every sub-frame the drawn `layout` has — each folder opened in place, outer before inner */
export const openFrames = (layout: BoardLayout): OpenFrame[] => {
  const out: OpenFrame[] = [];
  const walk = (items: readonly FrameItem[], project: string, x: number, y: number) => {
    for (const it of items) {
      if (it.kind !== "sub") continue;
      const open = { id: it.id, project, x: x + it.x, y: y + it.y, w: it.w, h: it.h };
      out.push(open);
      walk(it.items, project, open.x, open.y);
    }
  };
  for (const f of layout.frames) walk(f.layout.items, f.id, f.x, f.y);
  return out;
};

/**
 * The folder whose frame takes a card let go at board point `p` (#231 D15):
 * the innermost frame under it — the last of the open sub-frames in the
 * frame under it (the topmost) that holds it, an inner one inside its outer
 * one; else that project's frame.
 */
export const landingFolder = (layout: BoardLayout, p: { x: number; y: number }): string | null => {
  const frame = frameAtPoint(layout, p);
  if (!frame) return null;
  const holds = (r: FrameRect) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  return (
    openFrames(layout)
      .filter((o) => o.project === frame.id && holds(o))
      .at(-1)?.id ?? frame.id
  );
};

/**
 * Where a card for `item`, now in folder `from`, lands if let go at board
 * point `p` (#231 D15): the folder of the frame under it, when that is not
 * where it is already and `canPlace` lets it go there — never a folder into
 * itself or under it, nor past the depth limit
 * (#230 D7). `null`: nowhere.
 */
export const dropTarget = (
  layout: BoardLayout,
  item: ItemKey,
  from: string,
  p: { x: number; y: number },
): string | null => {
  const to = landingFolder(layout, p);
  const folders = layout.frames.map((f) => f.folder);
  return to !== null && to !== from && canPlace(folders, item, to) ? to : null;
};

/** an empty project's frame — what New project makes (D15): its message, not a card (#231 D13) */
export const NEW_FRAME = {
  w: 2 * FRAME_PAD + EMPTY_W,
  h: FRAME_HEAD + EMPTY_H + FRAME_PAD,
} as const;

/**
 * Where a new, empty project made at board point `p` goes (D15): there, or
 * the nearest room past what is in the way — it makes room ("last"), the
 * frames already there stay.
 */
export const placeNewFrame = (
  layout: BoardLayout,
  p: { x: number; y: number },
): { x: number; y: number } => {
  const id = "\u0000new";
  const fresh: FrameRect = { id, x: Math.round(p.x), y: Math.round(p.y), ...NEW_FRAME };
  const settled = settleFrames<FrameRect>([...layout.frames, fresh], { last: id });
  const at = settled[settled.length - 1]!;
  return { x: at.x, y: at.y };
};
