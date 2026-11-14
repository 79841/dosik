import { create } from "zustand";

import { DASHBOARD, type HomeView, sameHomeView } from "./homeView";
import type { ScreenStamp } from "./screenStamp";
import {
  type DocTab,
  EMPTY_SESSION,
  newTab,
  parseSession,
  SESSION_KEY,
  type TabSession,
} from "./tabModel";

export type AppView = "home" | "editor";

/** Home's New folder asking the new folder's card to name it, on the screen it was asked from */
export interface FolderRenameRequest {
  id: string;
  asked: ScreenStamp;
}

interface AppState {
  /**
   * Which screen is up — Home exactly while no document tab is active (#218).
   * `home` unmounts the editor entirely: a canvas alive behind the project
   * list would keep the keymap, the bridge and autosave acting on a document
   * that belongs to no project.
   */
  view: AppView;
  /**
   * What the Home tab shows (#220 D1) — the dashboard, Recent, a project or
   * a diagram; the sidebar's selection reads it too. Session memory:
   * a restart opens on the dashboard. Kept while a document tab is active, so
   * the Home tab goes back to it (#218 D3).
   */
  homeView: HomeView;
  /**
   * Bumped by a move made inside Home's sheet (See all, a card, the path…):
   * the new view's heading takes focus (#220 D16). A move from the sidebar
   * leaves focus in the tree, so it does not bump this.
   */
  homeFocus: number;
  /**
   * The project picked with the dashboard's Change (#220 D8) — new diagrams
   * go there while nothing nearer says where. Session memory only.
   */
  newDiagramTarget: string | null;
  /**
   * The sidebar's Rename asked the strip to edit this document tab's title
   * in place (#219 D3) — once: the strip takes the request.
   */
  titleEditRequest: string | null;
  /**
   * Home's New folder asked the new folder's card to name it in place
   * (#231 D8, which changed #229 D11 on Home) — once: the card with this id
   * takes the request, and drops it if the screen is no longer the one it
   * was asked on. It never waits for a card drawn later (#231 C1): another
   * screen clears it, and so does the board when it draws no card for it.
   */
  folderRenameRequest: FolderRenameRequest | null;
  /** the open documents, in strip order (#218) — Home is not one of them */
  tabs: DocTab[];
  /** the document tab on screen; `null` is Home */
  activeTab: string | null;
  /** what Home shows; the active tab stays as it is. `focus`: its heading takes focus */
  setHomeView: (view: HomeView, focus?: boolean) => void;
  setNewDiagramTarget: (folder: string | null) => void;
  /**
   * `tabActions` only: the tab list and the active tab, with `view` following
   * in the same set, so the two can never disagree.
   */
  commitTabs: (next: {
    tabs: DocTab[];
    activeTab: string | null;
    homeView?: HomeView;
    focus?: boolean;
  }) => void;
  requestTitleEdit: (tab: string) => void;
  /** the tab whose title was asked for, clearing the request */
  takeTitleEdit: () => string | null;
  /** asks folder `id`'s card to name it — on the screen that is up now */
  requestFolderRename: (id: string) => void;
  /** the request, clearing it */
  takeFolderRename: () => FolderRenameRequest | null;
}

/** what the app last had open (#218 D15) — read once, when the app starts */
const readSession = (): TabSession => {
  try {
    return parseSession(localStorage.getItem(SESSION_KEY));
  } catch {
    // blocked storage: the app starts as it did before tabs, on Home
    return { ...EMPTY_SESSION };
  }
};

/** the session the app started with; `tabSession` activates its `active` */
export const startupSession: TabSession = readSession();

/** the session's diagrams, as tabs not read yet — each is read when first activated */
const restoredTabs = (): DocTab[] =>
  startupSession.tabs.map(({ projectId, title }) =>
    newTab({ projectId, filePath: null, title }, false),
  );

/** Neither document state nor canvas UI state — the app's own screen. */
export const useAppStore = create<AppState>((set, get) => ({
  view: "home",
  homeView: DASHBOARD,
  homeFocus: 0,
  newDiagramTarget: null,
  titleEditRequest: null,
  folderRenameRequest: null,
  tabs: restoredTabs(),
  activeTab: null,
  setHomeView: (homeView, focus = false) =>
    set((s) => ({ homeView, homeFocus: focus ? s.homeFocus + 1 : s.homeFocus })),
  setNewDiagramTarget: (newDiagramTarget) => set({ newDiagramTarget }),
  commitTabs: ({ tabs, activeTab, homeView, focus = false }) =>
    set((s) => ({
      tabs,
      activeTab,
      view: activeTab === null ? "home" : "editor",
      ...(homeView !== undefined ? { homeView } : {}),
      homeFocus: focus ? s.homeFocus + 1 : s.homeFocus,
    })),
  requestTitleEdit: (titleEditRequest) => set({ titleEditRequest }),
  takeTitleEdit: () => {
    const tab = get().titleEditRequest;
    if (tab !== null) set({ titleEditRequest: null });
    return tab;
  },
  requestFolderRename: (id) => {
    const { view, activeTab, homeView } = get();
    set({ folderRenameRequest: { id, asked: { view, activeTab, homeView } } });
  },
  takeFolderRename: () => {
    const request = get().folderRenameRequest;
    if (request !== null) set({ folderRenameRequest: null });
    return request;
  },
}));

// No dispose: an HMR re-evaluation stacks duplicate subscriptions, which are
// idempotent here. A folder's name asked on one screen is not asked on
// another (#231 C1): another view or tab, or Home showing something else —
// the same view as a fresh object (its heading taking focus) is no change.
useAppStore.subscribe((now, before) => {
  if (
    now.folderRenameRequest !== null &&
    (now.view !== before.view ||
      now.activeTab !== before.activeTab ||
      !sameHomeView(now.homeView, before.homeView))
  ) {
    useAppStore.setState({ folderRenameRequest: null });
  }
});
