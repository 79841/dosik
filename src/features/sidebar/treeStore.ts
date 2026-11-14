import { create } from "zustand";

import { useDiagramStore } from "../../shared/lib/store";
import { useAppStore } from "../library/appStore";
import { type HomeView, resolveHomeView, sameHomeView } from "../library/homeView";
import { useLibraryStore } from "../library/libraryStore";
import {
  diagramKey,
  FOLDER_PREFIX,
  folderKey,
  homeOpenKeys,
  homeSelectionKey,
  openKeys,
  type TreeKey,
} from "./treeModel";

interface TreeState {
  /**
   * The unfolded rows. Session memory only (D7): the docked sidebar and the
   * peek are separate mounts and must agree, Home ↔ editor must not fold
   * anything, and a restart starts folded again (#176).
   */
  expanded: ReadonlySet<TreeKey>;
  /** the project whose name is being edited in the tree (+ New project, F2, Rename) */
  renaming: string | null;
  /** a row to scroll into view once — the diagram just opened (D7), or what Home now shows (#220 D3) */
  reveal: TreeKey | null;
  /**
   * The row a click or Space picked (#230 D8): selected in place of where the
   * app is — what Home shows, the diagram in the editor — until that moves.
   * One click selects and nothing else; the screen stays.
   */
  picked: TreeKey | null;
  pick: (key: TreeKey) => void;
  toggle: (key: TreeKey) => void;
  expand: (keys: TreeKey[]) => void;
  collapse: (key: TreeKey) => void;
  setRenaming: (id: string | null) => void;
  clearReveal: () => void;
}

const INITIAL = { expanded: new Set<TreeKey>(), renaming: null, reveal: null, picked: null };

export const useTreeStore = create<TreeState>((set, get) => ({
  ...INITIAL,
  toggle: (key) => (get().expanded.has(key) ? get().collapse(key) : get().expand([key])),
  expand: (keys) => {
    const missing = keys.filter((k) => !get().expanded.has(k));
    if (missing.length > 0) set({ expanded: new Set([...get().expanded, ...missing]) });
  },
  collapse: (key) => {
    if (!get().expanded.has(key)) return;
    const next = new Set(get().expanded);
    next.delete(key);
    set({ expanded: next });
  },
  setRenaming: (renaming) => set({ renaming }),
  pick: (picked) => set({ picked }),
  clearReveal: () => set({ reveal: null }),
}));

/**
 * A diagram that opened and whose row has not been unfolded yet. Opening
 * unfolds it once (D7); a listing that lands later — a save, Home on show —
 * must not undo a fold the user made since.
 */
let pending: string | null = null;

const unfoldOpened = () => {
  if (!pending) return;
  const keys = openKeys(useLibraryStore.getState().folders, pending);
  // not listed yet (a new diagram, the first listing still out): wait for it
  if (keys.length === 0) return;
  const row = diagramKey(pending);
  pending = null;
  useTreeStore.getState().expand(keys);
  useTreeStore.setState({ reveal: row });
};

/**
 * A Home view on screen whose row has not been brought into view yet (#220
 * D3): its ancestors and its own row unfold once (#231 D1) and the row
 * scrolls into view — focus stays where it is. Like `pending`, it waits for
 * a listing that has the row; a later listing must not undo a fold the user
 * made since.
 */
let pendingHome: HomeView | null = null;
/**
 * The folder on show whose own row had nothing to unfold (D7): it unfolds
 * once the listing gives it something — while Home still shows it — and
 * only it, not the ancestors already unfolded once (#231 D1).
 */
let emptyHome: string | null = null;

const unfoldHome = () => {
  const { folders } = useLibraryStore.getState();
  if (folders === null) return;
  const tree = useTreeStore.getState();
  if (emptyHome) {
    const row = folderKey(emptyHome);
    if (homeOpenKeys({ kind: "folder", folder: emptyHome }, folders).includes(row)) {
      emptyHome = null;
      tree.expand([row]);
    }
  }
  if (!pendingHome) return;
  const view = resolveHomeView(pendingHome, folders);
  pendingHome = null;
  const keys = homeOpenKeys(view, folders);
  tree.expand(keys);
  // a folder's row; the nav rows are always in view
  if (view.kind !== "folder") return;
  const row = homeSelectionKey(view);
  if (!keys.includes(row)) emptyHome = view.folder;
  useTreeStore.setState({ reveal: row });
};

// No dispose: an HMR re-evaluation stacks duplicate subscriptions, which are
// idempotent here — restart `tauri dev` after changing this module anyway.
/** where the app is moved: what was picked gives way to it (#230 D8) */
const forgetPick = () => {
  if (useTreeStore.getState().picked !== null) useTreeStore.setState({ picked: null });
};

useDiagramStore.subscribe((state, prev) => {
  if (state.projectId === prev.projectId) return;
  forgetPick();
  pending = state.projectId;
  unfoldOpened();
});
useLibraryStore.subscribe((state, prev) => {
  if (state.folders === prev.folders) return;
  unfoldOpened();
  unfoldHome();
});
useAppStore.subscribe((state, prev) => {
  if (
    state.view !== prev.view ||
    state.homeView !== prev.homeView ||
    state.activeTab !== prev.activeTab
  ) {
    forgetPick();
  }
});
// Home comes up, or what it shows changes while it is up — the same view as
// a fresh object (its heading taking focus) is no change (#231 D1)
useAppStore.subscribe((state, prev) => {
  if (state.view === prev.view && sameHomeView(state.homeView, prev.homeView)) return;
  // what Home showed is gone from the screen: nothing of it waits any more
  pendingHome = null;
  emptyHome = null;
  if (state.view !== "home") return;
  pendingHome = state.homeView;
  unfoldHome();
});

/**
 * The folders the sidebar has unfolded, by id — what a Move to… picker opens
 * with, wherever it opens (#229)
 */
export const unfoldedFolders = (): ReadonlySet<string> =>
  new Set(
    [...useTreeStore.getState().expanded].flatMap((key) =>
      key.startsWith(FOLDER_PREFIX) ? [key.slice(FOLDER_PREFIX.length)] : [],
    ),
  );

export const resetTreeForTests = (): void => {
  pending = null;
  pendingHome = null;
  emptyHome = null;
  useTreeStore.setState({ ...INITIAL, expanded: new Set() });
};
