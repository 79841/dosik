import { itemKey, parseItemKey } from "../../library/libraryApi";
import { findDiagram, findFolder, isInside } from "../../library/libraryTree";
import { FRAME_HEAD, type FrameItem } from "./boardGeometry";
import type { BoardLayout } from "./boardLayout";
import type { Rect } from "./boardViewport";

/**
 * The board's keyboard stops (#221 D20): each frame's name, each card — a
 * diagram's or a folder's (#231 D13), in a frame or in an open folder's
 * sub-frame (D14) — and each stack; one Tab stop among them all (roving),
 * the arrows moving through space.
 */
export interface NavItem {
  /** `frame:{project}`, `card:{diagram}`, `folder:{folder}`, `stack:{project}` */
  key: string;
  kind: "frame" | "card" | "folder" | "stack";
  /** the project it is in */
  frame: string;
  /** the diagram or the folder a card stands for */
  id?: string;
  /** in board units */
  rect: Rect;
}

export const frameKey = (folder: string) => `frame:${folder}`;
export const cardKey = (diagram: string) => `card:${diagram}`;
export const folderKey = (folder: string) => `folder:${folder}`;
export const stackKey = (folder: string) => `stack:${folder}`;

/**
 * The stops among `items` of project `frame`, laid out from (`x`, `y`) on
 * the board — an open folder's sub-frame adds its own place to its items'.
 */
const stopsIn = (items: readonly FrameItem[], frame: string, x: number, y: number): NavItem[] =>
  items.flatMap((it): NavItem[] => {
    const rect = { x: x + it.x, y: y + it.y, w: it.w, h: it.h };
    switch (it.kind) {
      case "card":
        return [{ key: cardKey(it.id), kind: "card", frame, id: it.id, rect }];
      case "folder":
        return [{ key: folderKey(it.id), kind: "folder", frame, id: it.id, rect }];
      case "stack":
        return [{ key: stackKey(frame), kind: "stack", frame, rect }];
      case "sub":
        return stopsIn(it.items, frame, rect.x, rect.y);
      default:
        return [];
    }
  });

/** every stop the drawn `layout` has */
export const navItems = (layout: BoardLayout): NavItem[] =>
  layout.frames.flatMap((f) => [
    {
      key: frameKey(f.id),
      kind: "frame" as const,
      frame: f.id,
      rect: { x: f.x, y: f.y, w: f.w, h: FRAME_HEAD },
    },
    ...stopsIn(f.layout.items, f.id, f.x, f.y),
  ]);

const byPlace = (a: Rect, b: Rect) => a.y - b.y || a.x - b.x;

/** top to bottom, left to right — frame by frame, then inside each frame */
export const readingOrder = (items: readonly NavItem[]): NavItem[] => {
  const frames = new Map<string, NavItem[]>();
  for (const item of items) frames.set(item.frame, [...(frames.get(item.frame) ?? []), item]);
  const corner = (list: NavItem[]): Rect =>
    list.reduce((best, i) => (byPlace(i.rect, best) < 0 ? i.rect : best), list[0]!.rect);
  return [...frames.values()]
    .sort((a, b) => byPlace(corner(a), corner(b)))
    .flatMap((list) => [...list].sort((a, b) => byPlace(a.rect, b.rect)));
};

/**
 * Where focus goes when what `gone` picks leaves the board (#221): the
 * next item after `from` in reading order that stays, else the nearest one
 * before it — `null` when nothing stays.
 */
export const neighbourOf = (
  items: readonly NavItem[],
  from: string,
  gone: (item: NavItem) => boolean,
): string | null => {
  const ordered = readingOrder(items);
  const at = ordered.findIndex((i) => i.key === from);
  const after = ordered.slice(at + 1).find((i) => !gone(i));
  const before = ordered
    .slice(0, Math.max(at, 0))
    .reverse()
    .find((i) => !gone(i));
  return (after ?? before)?.key ?? null;
};

/**
 * What stands in for the item `key` names on the drawn `layout` (#221, #231 D13, D14): the item itself while it is drawn; else what
 * holds it now — a card or a folder moved into a folder → that folder's
 * card, one folded into a stack (or inside a folder that is) → that stack,
 * an unfolded stack → its project's front item; a folder opened in place →
 * the first item of its sub-frame (none: its project's name), and what was
 * in a sub-frame now closed → the card of the folder that holds it. Failing
 * that, its project's name; `null` when the project, the diagram or the
 * folder is gone.
 */
export const standIn = (layout: BoardLayout, key: string): string | null => {
  if (navItems(layout).some((i) => i.key === key)) return key;
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  if (at < 0 || !id) return null;
  if (kind === "frame" || kind === "stack") {
    const frame = layout.byId.get(id);
    if (!frame) return null;
    const front = frame.layout.items.find((it) => it.kind === "card" || it.kind === "folder");
    if (kind === "stack" && front?.kind === "card") return cardKey(front.id);
    if (kind === "stack" && front?.kind === "folder") return folderKey(front.id);
    return frameKey(frame.id);
  }
  if (kind !== "card" && kind !== "folder") return null;
  const folders = layout.frames.map((f) => f.folder);
  const path = kind === "card" ? findDiagram(folders, id)?.path : findFolder(folders, id)?.path;
  const frame = path?.[0] ? layout.byId.get(path[0].id) : undefined;
  if (!frame) return null;
  /** whether the drawn folder `holder` is the item or holds it */
  const holds = (holder: string) => isInside(folders, id, holder);
  const item = itemKey(kind === "card" ? "diagram" : "folder", id);
  const among = (items: readonly FrameItem[]): string | null => {
    for (const it of items) {
      if (it.kind === "folder" && holds(it.id)) return folderKey(it.id);
      if (it.kind === "sub" && holds(it.id)) {
        if (it.id !== id) return among(it.items);
        const [first] = stopsIn(it.items, frame.id, 0, 0).sort((a, b) => byPlace(a.rect, b.rect));
        return first?.key ?? null;
      }
      const inStack =
        it.kind === "stack" &&
        it.keys.some((k) => {
          const parsed = parseItemKey(k);
          return k === item || (parsed?.kind === "folder" && holds(parsed.id));
        });
      if (inStack) return stackKey(frame.id);
    }
    return null;
  };
  return among(frame.layout.items) ?? frameKey(frame.id);
};

export type NavKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * Where an arrow goes from `from` (D20): of the items whose centre lies on
 * that side, the one nearest by (distance along + 2 × distance across), the
 * earlier in reading order on a tie; none — it stays. Home and End go to the
 * first and the last in reading order.
 */
export const spatialNext = (items: readonly NavItem[], from: string, key: NavKey): string => {
  const ordered = readingOrder(items);
  if (key === "Home") return ordered[0]?.key ?? from;
  if (key === "End") return ordered[ordered.length - 1]?.key ?? from;
  const here = ordered.find((i) => i.key === from);
  if (!here) return from;
  const c = centre(here.rect);
  let best: { key: string; score: number } | null = null;
  for (const item of ordered) {
    if (item === here) continue;
    const o = centre(item.rect);
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    const [along, across] =
      key === "ArrowRight"
        ? [dx, dy]
        : key === "ArrowLeft"
          ? [-dx, dy]
          : key === "ArrowDown"
            ? [dy, dx]
            : [-dy, dx];
    if (along <= 0) continue;
    const score = along + 2 * Math.abs(across);
    if (!best || score < best.score) best = { key: item.key, score };
  }
  return best?.key ?? from;
};
