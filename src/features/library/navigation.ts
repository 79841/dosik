import { useDiagramStore } from "../../shared/lib/store";
import { toastError, useToastStore } from "../../shared/lib/toastStore";
import { useAppStore } from "./appStore";
import type { HomeView } from "./homeView";
import { type ScreenStamp, stillOnScreen } from "./screenStamp";
import { openExternalFile } from "./projectActions";
import {
  activateNth,
  activateTab,
  closeActiveTab,
  closeTab,
  cycleTab,
  newDiagramTab,
  openLibraryDiagram,
  showHomeTab,
} from "./tabActions";

/**
 * Every way around the app that the chrome offers (#217): the sidebar's tree
 * and Views, the tabs, the More menu, the toolbar, Home and the keymap all
 * call these, so each failure is a toast — nowhere is it done by hand. Since
 * tabs (#218 D18) none of them drops a document: what was open stays in its
 * tab, so nothing asks about unsaved edits on the way.
 */

/**
 * The Home tab showing `view` (#220 D1) — the dashboard, Recent or a folder
 * (#231 D1). The document tabs stay; on Home it only changes what
 * Home shows. Nothing can make the user stay (#218 D8), so it is done when
 * this returns. A move made inside Home's sheet passes `focus`, so the new
 * view's heading takes it; one made from the sidebar leaves focus in the
 * tree (D16).
 */
export const viewInHome = (view: HomeView, focus = false): void => {
  showHomeTab(view, focus);
};

/**
 * After a delete asked from Home: the title of `view` — where the delete left
 * Home — takes the focus, only while the screen is still the one it was
 * asked from (#218 D15, #229).
 */
export const focusHomeTitleIfStill = (stamp: ScreenStamp, view: HomeView): void => {
  if (stillOnScreen(stamp, { homeView: view })) useAppStore.getState().setHomeView(view, true);
};

/** The Home tab (D2): back to the Home that was last on show — the dashboard or a project. */
export const returnHome = (): void => {
  showHomeTab();
};

/** The sidebar's Recent row (#220 D10): Home's Recent view */
export const showRecent = (): void => {
  viewInHome({ kind: "recent" });
};

/**
 * A diagram from the library. A diagram open in a tab is not read again —
 * its tab comes up, so its undo history stays (#218 D19).
 */
export const openFromLibrary = async (id: string): Promise<void> => {
  try {
    await openLibraryDiagram(id);
  } catch (error) {
    toastError(error);
  }
};

/**
 * The sidebar row's Rename (#219 D3): the diagram is opened — or its tab
 * comes up — and its tab edits the title in place. The title is changed on
 * the open document, which autosaves, so no path renames a file that is not
 * open. A diagram that cannot be read is a toast and nothing more. Resolves
 * whether a tab took the edit — when none did, the caller keeps the focus.
 */
export const renameDiagram = async (id: string): Promise<boolean> => {
  await openFromLibrary(id);
  const { activeTab } = useAppStore.getState();
  if (activeTab === null || useDiagramStore.getState().projectId !== id) return false;
  useAppStore.getState().requestTitleEdit(activeTab);
  return true;
};

/**
 * New diagram — the tab strip's +, ⌘T and ⌘N, where `targetFolder` says
 * (#220 D8), or `folder`'s, from its tree row or its Home screen (#217 D4).
 * A new *library* diagram (#114), saved from the first edit, in a new tab
 * (#218 D11): what was on screen stays in its own, so nothing asks first.
 */
export const newDiagram = async (folder?: string): Promise<void> => {
  try {
    await newDiagramTab(folder);
  } catch (error) {
    toastError(error);
  }
};

/**
 * Open file… — the sidebar's, the More menu's, ⌘O, the toolbar's and Home's
 * (D22): pick, then a tab — the file's own if it is open already — and
 * "Diagram opened" when one was opened just now ("…in a new tab" when the
 * user went elsewhere while it was read). A malformed file throws before
 * anything changes.
 */
export const openFileAnywhere = async (): Promise<void> => {
  try {
    const opened = await openExternalFile();
    if (opened === "shown") useToastStore.getState().pushToast("Diagram opened");
    else if (opened === "beside") useToastStore.getState().pushToast("Diagram opened in a new tab");
  } catch (error) {
    toastError(error);
  }
};

/** a tab move that can fail — a failure is a toast and `fallback`, never an unhandled rejection */
const orToast = async <T>(task: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    toastError(error);
    return fallback;
  }
};

/**
 * Closes tab `id` — ×, middle click (#218 D10). Resolves whether it closed:
 * a Cancel, or a question that could not be asked (a toast), keeps it.
 */
export const closeDocumentTab = (id: string): Promise<boolean> =>
  orToast(() => closeTab(id), false);

/** ⌘W — File ▸ Close Tab — and Ctrl+W (D12): the active document tab; `false` on Home */
export const closeActiveDocumentTab = (): Promise<boolean> => orToast(closeActiveTab, false);

/** a tab of the strip, Home (`null`) included */
export const goToTab = (id: string | null): Promise<void> =>
  orToast(() => activateTab(id), undefined);

/** ⌃Tab / ⌃⇧Tab, ⌘⇧] / ⌘⇧[ (D12) */
export const cycleTabs = (dir: 1 | -1): Promise<void> => orToast(() => cycleTab(dir), undefined);

/** ⌘1–⌘9 (D12) */
export const goToNthTab = (n: number): Promise<void> => orToast(() => activateNth(n), undefined);
