import { create } from "zustand";

import { type FolderMeta, type ItemKey, itemKey } from "../library/libraryApi";

/**
 * The one card selected on Home (#231 D7) — a click on it, or the arrows on
 * the grid. Apart from Home's view (`homeView`) and from the tree's selection,
 * so neither follows the card. Held in memory for the session: it outlives
 * Home's sheet (a document tab and back) and the Cards / Canvas switch (the
 * board draws no ring). It holds the item's key only, never the item — a view
 * asks `selectedIn` whether it is still there.
 */
interface HomeSelectionState {
  /** the folder whose view the card was selected in */
  folder: string | null;
  key: ItemKey | null;
  select: (folder: string, key: ItemKey) => void;
  clear: () => void;
}

export const useHomeSelection = create<HomeSelectionState>((set) => ({
  folder: null,
  key: null,
  select: (folder, key) => set({ folder, key }),
  clear: () => set({ folder: null, key: null }),
}));

/**
 * The card selected in `folder`'s view: none when the selection is another
 * folder's, or when the item has gone from it (deleted, moved away).
 */
export const selectedIn = (
  selection: Pick<HomeSelectionState, "folder" | "key">,
  folder: FolderMeta,
): ItemKey | null => {
  const { key } = selection;
  if (key === null || selection.folder !== folder.id) return null;
  const held =
    folder.folders.some((f) => itemKey("folder", f.id) === key) ||
    folder.diagrams.some((d) => itemKey("diagram", d.id) === key);
  return held ? key : null;
};
