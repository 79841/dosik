import type { RefObject } from "react";
import { create } from "zustand";

import { useAppStore } from "../../library/appStore";
import { sameHomeView } from "../../library/homeView";
import type { BoardSpot, FolderMeta, ItemKey } from "../../library/libraryApi";
import { useHomeMode } from "../homeMode";
import type { Viewport } from "./boardViewport";

/** a card or a frame on its way somewhere (D13, D14) — `dx`/`dy` in board units */
export type BoardDrag =
  | {
      /** a diagram's card or a folder's (#231 D15) */
      kind: "card";
      item: ItemKey;
      /** the folder it is leaving */
      from: string;
      dx: number;
      dy: number;
      /** the folder it would land in now, if it can */
      target: string | null;
    }
  | { kind: "frame"; id: string; dx: number; dy: number };

type Placed = { id: string; board: BoardSpot };
type Point = { x: number; y: number };

/**
 * The one menu the board has open (#221 D15) — drawn at the board's root,
 * outside the transformed layer. `at` is a client point; `from` is the item
 * that takes focus back when it closes; `opener` is the button that opened
 * it, if one did — pressing it again closes the menu (#220). A
 * folder card's is a folder's menu, a frame's + the New menu (#231 D13).
 */
export type BoardMenu =
  | { kind: "canvas"; at: Point; board: Point }
  | {
      kind: "project";
      folder: string;
      at: Point;
      from: string;
      opener?: RefObject<HTMLElement | null>;
    }
  | { kind: "folder"; folder: string; at: Point; from: string }
  | { kind: "diagram"; diagram: string; at: Point; from: string }
  | {
      kind: "new";
      folder: string;
      at: Point;
      from: string;
      opener: RefObject<HTMLElement | null>;
    };

interface BoardState {
  /** the camera, for this run of the app (D10) — `null` until the board is first drawn */
  viewport: Viewport | null;
  /** whether the last camera move was the program's — it glides; a hand's does not */
  animate: boolean;
  /** the camera before a focus (D11, D12) — where Esc and Back go */
  beforeFocus: Viewport | null;
  /**
   * Places sent this session that the listing has not caught up with (D9):
   * the board draws them, so a listing that lands before a write does not
   * snap a frame back.
   */
  overlay: Record<string, BoardSpot>;
  /** projects whose automatic place could not be written — not tried again this run */
  failed: ReadonlySet<string>;
  drag: BoardDrag | null;
  /** the project whose name is being edited in its frame, or the folder on its card (#231 D13) */
  renaming: string | null;
  /** the item that holds the board's Tab stop (D20) */
  current: string | null;
  menu: BoardMenu | null;
  ensureViewport: (make: () => Viewport) => void;
  setViewport: (viewport: Viewport, animate?: boolean) => void;
  /** a focus moves the camera; the first one remembers where it was */
  focusCamera: (viewport: Viewport) => void;
  /** back to where the camera was before the focus — nothing without one */
  unfocusCamera: () => void;
  sent: (placed: Placed[]) => void;
  /** a write failed: its places leave the overlay, unless a later one replaced them */
  unsent: (placed: Placed[]) => void;
  /** a listing landed: what it confirms, and what it no longer lists, leaves the overlay */
  reconcile: (folders: FolderMeta[]) => void;
  markFailed: (ids: string[]) => void;
  setDrag: (drag: BoardDrag | null) => void;
  setRenaming: (id: string | null) => void;
  setCurrent: (key: string | null) => void;
  openMenu: (menu: BoardMenu) => void;
  closeMenu: () => void;
}

export const sameSpot = (a: BoardSpot | undefined, b: BoardSpot | undefined): boolean =>
  a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.collapsed === b.collapsed;

const initial = {
  viewport: null,
  animate: false,
  beforeFocus: null,
  overlay: {},
  failed: new Set<string>(),
  drag: null,
  renaming: null,
  current: null,
  menu: null,
};

/**
 * The library board's session state (#221): the camera, the places on their
 * way to disk, a drag, a rename. Nothing here is saved — what lasts is in
 * each project's folder.json, and the view in `appStore.homeView`.
 */
export const useBoardStore = create<BoardState>((set, get) => ({
  ...initial,
  ensureViewport: (make) => {
    if (get().viewport === null) set({ viewport: make(), animate: false });
  },
  setViewport: (viewport, animate = false) => set({ viewport, animate }),
  focusCamera: (viewport) =>
    set((s) => ({ viewport, animate: true, beforeFocus: s.beforeFocus ?? s.viewport })),
  unfocusCamera: () =>
    set((s) =>
      s.beforeFocus ? { viewport: s.beforeFocus, beforeFocus: null, animate: true } : {},
    ),
  sent: (placed) =>
    set((s) => ({
      overlay: { ...s.overlay, ...Object.fromEntries(placed.map((p) => [p.id, p.board])) },
    })),
  unsent: (placed) =>
    set((s) => {
      const overlay = { ...s.overlay };
      for (const { id, board } of placed) if (sameSpot(overlay[id], board)) delete overlay[id];
      return { overlay };
    }),
  reconcile: (folders) =>
    set((s) => {
      const listed = new Map(folders.map((f) => [f.id, f.board]));
      const overlay: Record<string, BoardSpot> = {};
      for (const [id, spot] of Object.entries(s.overlay)) {
        if (listed.has(id) && !sameSpot(listed.get(id), spot)) overlay[id] = spot;
      }
      return { overlay };
    }),
  markFailed: (ids) => set((s) => ({ failed: new Set([...s.failed, ...ids]) })),
  setDrag: (drag) => set({ drag }),
  setRenaming: (renaming) => set({ renaming }),
  setCurrent: (current) => set({ current }),
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
}));

// No dispose (idempotent under HMR). A name field open on the board goes
// with the screen, as a new folder's request does (#231 C1, D8·D13): another view or tab, Home showing something else — the same view as a
// fresh object is no change — or the other mode.
const endRename = () => {
  if (useBoardStore.getState().renaming !== null) useBoardStore.getState().setRenaming(null);
};
useAppStore.subscribe((now, before) => {
  if (
    now.view !== before.view ||
    now.activeTab !== before.activeTab ||
    !sameHomeView(now.homeView, before.homeView)
  ) {
    endRename();
  }
});
useHomeMode.subscribe((now, before) => {
  if (now.mode !== before.mode) endRename();
});

/** test seam: a board never drawn */
export const resetBoardForTests = (): void => {
  useBoardStore.setState({ ...initial, failed: new Set() });
};
