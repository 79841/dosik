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

/**
 * ⌥↑/⌥↓: one place up or down among its siblings — the edge it is at, or
 * `null` when it does not move (a project not found, #253 R7)
 */
type KeyboardStep = (Placement & { count: number }) | { edge: "first" | "last" } | null;

export const keyboardStep = (
  folders: readonly FolderMeta[],
  item: ItemKey,
  dir: -1 | 1,
): KeyboardStep => {
  const at = siblingsOf(folders, item);
  if (!at || at.index < 0 || !canPlace(folders, item, at.parent)) return null;
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
 * Where a drag would land (#230 D9): a slot among a folder's items — with
 * the row and edge its 2px line is drawn on, at the slot's level — or into a
 * folder (a project too), to its top, the folder row filled.
 */
export type DropTarget =
  | {
      kind: "slot";
      placement: Placement;
      line: { row: TreeKey; edge: "top" | "bottom"; level: number };
    }
  | { kind: "into"; folder: string; row: TreeKey; placement: Placement };

/** a row's own line on screen, top to bottom */
export interface RowBox {
  top: number;
  bottom: number;
}

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
  const real = blocks.filter((b) => b.row.node.kind !== "diagram");
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
    line: before
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
 * projects.
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
  if (found && found.path.length === 1) {
    return canPlace(folders, dragged, null)
      ? projectTarget(rows, boxes, y, dragged, folders)
      : null;
  }

  const hit = rowAt(rows, boxes, y);
  if (!hit) return null;
  const { row, box } = hit;
  const { node } = row;
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
    line: { row: TreeKey; edge: "top" | "bottom"; level: number },
  ): DropTarget | null => {
    const placement = settle(folders, dragged, parent, full);
    return placement && canPlace(folders, dragged, parent)
      ? { kind: "slot", placement, line }
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
