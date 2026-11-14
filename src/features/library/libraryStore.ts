import { create } from "zustand";

import { type FolderMeta, type ItemKey, listLibrary } from "./libraryApi";
import { findDiagram, type Placement, placedInList } from "./libraryTree";

/**
 * Places shown before their write landed (#230 D13): a listing that comes
 * meanwhile — someone else's refresh — gets them again, so the screen does
 * not jump back and forth.
 */
let placements: { item: ItemKey; to: Placement }[] = [];

const withPlacements = (folders: FolderMeta[]): FolderMeta[] =>
  placements.reduce((listed, p) => placedInList(listed, p.item, p.to), folders);

/**
 * Listings by when they were asked (#230): the listing runs off
 * the main thread, so one asked earlier can land after one asked later — it
 * then tells of an older disk, and is dropped.
 */
let asked = 0;
/** the newest-asked listing that has landed */
let landed = 0;

interface LibraryState {
  /** the library as last listed; `null` until the first listing lands */
  folders: FolderMeta[] | null;
  /**
   * The last listing failed (#178) — Home says "couldn't load", not "no
   * projects". Any later listing that lands clears it, whoever asked for it
   * (a New project made from the failure screen included).
   */
  readFailed: boolean;
  /**
   * lists the library again — Home on show and after every change, a new
   * diagram once made, and a library diagram left after it was written
   */
  refresh: () => Promise<FolderMeta[]>;
}

/**
 * The project/diagram tree (#161), shared by Home, the sidebar's tree (#217)
 * and the editor's toolbar, which shows the project the open diagram sits in. Rust owns the files; this
 * is only the last answer it gave.
 */
export const useLibraryStore = create<LibraryState>((set, get) => ({
  folders: null,
  readFailed: false,
  refresh: async () => {
    const mine = ++asked;
    try {
      const listed = await listLibrary();
      // a newer listing has landed meanwhile: this one is older news
      if (mine < landed) return get().folders ?? withPlacements(listed);
      landed = mine;
      const folders = withPlacements(listed);
      set({ folders, readFailed: false });
      return folders;
    } catch (error) {
      // keep what an earlier listing showed; with nothing, show the failure —
      // not when a newer listing already answered
      if (mine >= landed) set((s) => ({ folders: s.folders ?? [], readFailed: true }));
      throw error;
    }
  },
}));

/**
 * Lists the library again without a word: the tree and the toolbar's project
 * name follow it, and a failed listing costs only that — `readFailed` says so.
 */
export const refreshLibraryQuietly = (): void => {
  void useLibraryStore
    .getState()
    .refresh()
    .catch(() => undefined);
};

/** the folder a diagram is in — at any depth — if the last listing knows it */
export const folderOfProject = (
  folders: FolderMeta[] | null,
  projectId: string | null,
): FolderMeta | null =>
  projectId && folders ? (findDiagram(folders, projectId)?.folder ?? null) : null;

/**
 * Shows `item` at its new place at once (#230 D13) and keeps it there over
 * any listing until the returned function says its write is over.
 */
export const showPlacement = (item: ItemKey, to: Placement): (() => void) => {
  const placement = { item, to };
  placements = [...placements, placement];
  const { folders } = useLibraryStore.getState();
  if (folders) useLibraryStore.setState({ folders: placedInList(folders, item, to) });
  return () => {
    placements = placements.filter((p) => p !== placement);
  };
};

export const resetPlacementsForTests = (): void => {
  placements = [];
};
