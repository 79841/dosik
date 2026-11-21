import { type FolderMeta, type ItemKey, parseItemKey } from "../library/libraryApi";
import {
  canPlace,
  childKey,
  childrenOf,
  findFolder,
  isInside,
  type Placement,
  siblingsOf,
} from "../library/libraryTree";
import type { TreeKey, TreeRow } from "./treeModel";

/**
 * Where an item of the tree goes when it is moved by the keyboard or dragged
 * (#230 D9, D10) — worked out without the DOM, so it can be tested as a
 * table. The tree only draws what these return.
 */

/** ⌥↑/⌥↓: one place up or down among its siblings — the edge it is at, or `null` when it has none (the stray listing) */
type KeyboardStep = (Placement & { count: number }) | { edge: "first" | "last" } | null;

export const keyboardStep = (
  folders: readonly FolderMeta[],
  item: ItemKey,
  dir: -1 | 1,
): KeyboardStep => {
  const at = siblingsOf(folders, item);
  if (!at || at.index < 0) return null;
  const index = at.index + dir;
  if (index < 0) return { edge: "first" };
  if (index >= at.keys.length) return { edge: "last" };
  return { parent: at.parent, index, count: at.keys.length };
};

/**
 * What a screen reader hears after `name` moved to `placement` among its
 * `count` siblings (#230 D14) — a parent of `null` is the projects.
 */
export const placementNotice = (
  folders: readonly FolderMeta[],
  name: string,
  { parent, index }: Placement,
  count: number,
): string =>
  parent === null
    ? `Moved “${name}” to position ${index + 1} of ${count} projects`
    : `Moved “${name}” to position ${index + 1} of ${count} in ${findFolder(folders, parent)?.folder.name ?? ""}`;

/**
 * Where a drag would land (#230 D9): a slot among a folder's items — the
 * spot the preview stands at, before or after a row, at the slot's level
 * (#260) — or into a folder (a project too), to its top.
 */
export type DropTarget =
  | {
      kind: "slot";
      placement: Placement;
      spot: { row: TreeKey; edge: "top" | "bottom"; level: number };
    }
  | { kind: "into"; folder: string; row: TreeKey; placement: Placement };

/** a row's own line on screen, top to bottom */
export interface RowBox {
  top: number;
  bottom: number;
}

/** a row's height — the tree row's `h-[30px]` (#236) */
export const ROW_HEIGHT = 30;
/** from one row's top to the next — its height and the 1px between rows (`gap-y-px`, `mt-px`) */
export const ROW_PITCH = 31;
/** the tree list's top padding, above its first row — its `pt-0.5` */
export const LIST_PAD_TOP = 2;

/**
 * The rows' boxes as they stand with the first row's top at `origin` (#260):
 * worked out, not read from the screen, so neither the drag's preview nor the
 * rows gliding out of its way move what is under the pointer.
 */
export const rowBoxes = (rows: readonly TreeRow[], origin: number): Map<TreeKey, RowBox> =>
  new Map(
    rows.map((row, i) => {
      const top = origin + i * ROW_PITCH;
      return [row.key, { top, bottom: top + ROW_HEIGHT }];
    }),
  );

/** a row as a drag shows it — the preview's key is the dragged item's */
export interface ShownRow {
  key: TreeKey;
  level: number;
}

export interface DragView {
  /** the rows top to bottom, the preview's among them */
  shown: ShownRow[];
  /**
   * where among `shown` the preview stands, at what level — none while the
   * target is a collapsed folder, or when the dragged row is not among `rows`
   */
  preview: { index: number; level: number } | null;
  /** how far each row but the dragged one stands from its own place, in px — none for a row that stays */
  offsets: ReadonlyMap<TreeKey, number>;
}

/**
 * What the tree shows while `dragged` is over `target` (#260 R2): the
 * dragged row leaves its place and its preview stands where the drop would
 * put it, at that depth; the rows in between make room. `rows` are the rows
 * as they stand, the dragged one in its place (folded, if it is a folder).
 * Into an unfolded folder the preview is its first item; into a collapsed
 * one there is none, and nothing moves — the place stays, empty, so the
 * folder stays under the pointer. No target: the preview is the dragged row,
 * in its place.
 */
export const dragView = ({
  rows,
  dragged,
  target,
}: {
  rows: readonly TreeRow[];
  dragged: TreeKey;
  target: DropTarget | null;
}): DragView => {
  const all = rows.map(({ key, level }) => ({ key, level }));
  const from = rows.findIndex((r) => r.key === dragged);
  const still = (preview: DragView["preview"]): DragView => ({
    shown: all,
    preview,
    offsets: new Map(),
  });
  if (from < 0) return still(null);
  const inPlace = still({ index: from, level: rows[from]!.level });
  if (!target) return inPlace;
  const others = all.filter((r) => r.key !== dragged);
  let at: number;
  let level: number;
  if (target.kind === "into") {
    const holder = rows.find((r) => r.key === target.row);
    if (!holder) return inPlace;
    if (!holder.expanded) return still(null);
    at = others.findIndex((r) => r.key === holder.key) + 1;
    level = holder.level + 1;
  } else {
    const k = others.findIndex((r) => r.key === target.spot.row);
    if (k < 0) return inPlace;
    at = target.spot.edge === "top" ? k : k + 1;
    level = target.spot.level;
  }
  const shown = [...others.slice(0, at), { key: dragged, level }, ...others.slice(at)];
  const placeOf = new Map(rows.map((r, i) => [r.key, i]));
  const offsets = new Map<TreeKey, number>();
  shown.forEach((row, i) => {
    if (row.key === dragged) return;
    const by = (i - placeOf.get(row.key)!) * ROW_PITCH;
    if (by !== 0) offsets.set(row.key, by);
  });
  return { shown, preview: { index: at, level }, offsets };
};

/** a folder row's bands, 7/26 of its height (8 of today's 30, #236): the top band is before it, the bottom after (or into it, unfolded) */
const BAND = 7 / 26;

const idOf = (key: TreeKey | null): string | null => (key ? (parseItemKey(key)?.id ?? null) : null);

/**
 * The slot `parent`/`full` (a place among all its items, the dragged one
 * still counted) as a placement for `dragged` — its own place gone first
 * (#230 D9). `null` when it is where it is already.
 */
const settle = (
  folders: readonly FolderMeta[],
  dragged: ItemKey,
  parent: string | null,
  full: number,
): Placement | null => {
  const now = siblingsOf(folders, dragged);
  if (!now || now.parent !== parent || now.index < 0) return { parent, index: full };
  const index = now.index < full ? full - 1 : full;
  return index === now.index ? null : { parent, index };
};

/** the row under `y` — in a gap, the row below; `null` above or below them all */
const rowAt = (
  rows: readonly TreeRow[],
  boxes: ReadonlyMap<TreeKey, RowBox>,
  y: number,
): { row: TreeRow; box: RowBox; at: number } | null => {
  for (let at = 0; at < rows.length; at++) {
    const row = rows[at]!;
    const box = boxes.get(row.key);
    if (box && y < box.bottom) return y >= box.top || at > 0 ? { row, box, at } : null;
  }
  return null;
};

/** dragging a project: the projects' blocks — a row and what shows under it (#230 D9) */
const projectTarget = (
  rows: readonly TreeRow[],
  boxes: ReadonlyMap<TreeKey, RowBox>,
  y: number,
  dragged: ItemKey,
  folders: readonly FolderMeta[],
): DropTarget | null => {
  const blocks: { row: TreeRow; top: number; bottom: number; last: TreeRow }[] = [];
  for (const row of rows) {
    const box = boxes.get(row.key);
    if (!box) continue;
    if (row.level === 1) blocks.push({ row, top: box.top, bottom: box.bottom, last: row });
    else {
      const block = blocks.at(-1);
      if (block) Object.assign(block, { bottom: box.bottom, last: row });
    }
  }
  const real = blocks.filter((b) => b.row.node.kind !== "diagram" && !b.row.node.folder.stray);
  if (real.length === 0) return null;
  let full = real.length;
  for (const [i, block] of real.entries()) {
    if (y < (block.top + block.bottom) / 2) {
      full = i;
      break;
    }
  }
  const placement = settle(folders, dragged, null, full);
  if (!placement) return null;
  const before = real[full];
  const end = real.at(-1)!;
  return {
    kind: "slot",
    placement,
    spot: before
      ? { row: before.row.key, edge: "top", level: 1 }
      : { row: end.last.key, edge: "bottom", level: 1 },
  };
};

/**
 * Where `dragged` would land with the pointer at `y` over the tree's `rows`
 * (#230 D9) — `null` where nothing would change or it may not go (D7).
 * A diagram's row: its top half is before it, its bottom half after. A
 * folder's: the top 7px before, the middle into it (to its top), the bottom
 * 7px after it — or, unfolded, before its first item. A project's row is all
 * "into" for anything but a project, which goes by whole blocks among the
 * projects. The stray listing takes nothing.
 */
export const dropAt = ({
  rows,
  boxes,
  y,
  dragged,
  folders,
}: {
  rows: readonly TreeRow[];
  boxes: ReadonlyMap<TreeKey, RowBox>;
  y: number;
  dragged: ItemKey;
  folders: readonly FolderMeta[];
}): DropTarget | null => {
  const item = parseItemKey(dragged);
  if (!item) return null;
  const found = item.kind === "folder" ? findFolder(folders, item.id) : null;
  if (found && found.path.length === 1) return projectTarget(rows, boxes, y, dragged, folders);

  const hit = rowAt(rows, boxes, y);
  if (!hit) return null;
  const { row, box } = hit;
  const { node } = row;
  if (node.folder.stray) return null;
  const rowId = idOf(row.key)!;
  // never onto itself or anything under it
  if (row.key === dragged || (item.kind === "folder" && isInside(folders, rowId, item.id))) {
    return null;
  }

  const into = (): DropTarget | null => {
    const placement = settle(folders, dragged, rowId, 0);
    return placement && canPlace(folders, dragged, rowId)
      ? { kind: "into", folder: rowId, row: row.key, placement }
      : null;
  };
  const slot = (
    parent: string,
    full: number,
    spot: { row: TreeKey; edge: "top" | "bottom"; level: number },
  ): DropTarget | null => {
    const placement = settle(folders, dragged, parent, full);
    return placement && canPlace(folders, dragged, parent)
      ? { kind: "slot", placement, spot }
      : null;
  };
  /** where `row` is among its parent's items */
  const placeOf = (): { parent: string; index: number } | null => {
    const parent = idOf(row.parent);
    const holder = parent ? findFolder(folders, parent)?.folder : null;
    if (!parent || !holder) return null;
    return {
      parent,
      index: childrenOf(holder)
        .map(childKey)
        .indexOf(row.key as ItemKey),
    };
  };

  if (node.kind === "project") return into();
  const offset = (y - box.top) / (box.bottom - box.top);
  const here = placeOf();
  if (!here) return null;
  const before = () =>
    slot(here.parent, here.index, { row: row.key, edge: "top", level: row.level });
  const after = () =>
    slot(here.parent, here.index + 1, { row: row.key, edge: "bottom", level: row.level });

  if (node.kind === "diagram") return offset < 0.5 ? before() : after();
  if (offset < BAND) return before();
  if (offset < 1 - BAND) return into();
  if (!row.expanded) return after();
  const first = rows[hit.at + 1];
  return first ? slot(rowId, 0, { row: first.key, edge: "top", level: row.level + 1 }) : null;
};

/** how long a drag rests on a collapsed folder before it unfolds (#260 R3) — intent, not motion: reduced motion keeps it */
export const AUTO_UNFOLD_MS = 600;

/**
 * The folder a drag resting on `target` would unfold (#260 R3): into a
 * collapsed folder or project with something in it. Never the dragged item
 * or anything under it, nor where it may not go — `dropAt` gives no target
 * there.
 */
export const autoUnfoldKey = (
  target: DropTarget | null,
  rows: readonly TreeRow[],
): TreeKey | null => {
  if (target?.kind !== "into") return null;
  const row = rows.find((r) => r.key === target.row);
  return row?.expandable && !row.expanded ? row.key : null;
};

/**
 * Of the folders a drag unfolded, the ones that fold back when it ends
 * (#260 R3): all of them when it was called off (`dropParent` `null`), else
 * those the drop did not go into — itself or anywhere under it. Each on its
 * own; a folder the user had unfolded is not in `opened`.
 */
export const refoldAfterDrag = (
  opened: readonly TreeKey[],
  dropParent: string | null,
  folders: readonly FolderMeta[],
): TreeKey[] =>
  opened.filter((key) => {
    const id = idOf(key);
    return dropParent === null || id === null || !isInside(folders, dropParent, id);
  });
