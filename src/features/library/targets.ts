import { useDiagramStore } from "../../shared/lib/store";
import { useAppStore } from "./appStore";
import { homeFolderOf } from "./homeView";
import type { FolderMeta } from "./libraryApi";
import { folderOfProject, useLibraryStore } from "./libraryStore";
import { latestProject, savableFolder } from "./libraryTree";

/**
 * Where a new diagram goes (#161, #218 D11, #220 D8) — one rule for START,
 * the tab strip's +, ⌘T and ⌘N, and agent ops arriving on Home. The TS side always names the project it decided on, so the
 * dashboard's "New diagrams go to" line and the file's real folder cannot
 * disagree; only an empty library leaves the choice to Rust, which then makes
 * "My Diagrams".
 */

/**
 * ⑤ The most recently edited real project, ties to the one listed first — the one
 * Rust's `default_target` picks, so the project a save with no folder would
 * have landed in anyway. Worked out, not read off the listing, which is in
 * the user's order since #230 (D5).
 */
export const defaultTarget = (folders: FolderMeta[] | null): FolderMeta | null =>
  latestProject(folders);

/** ④ → ⑤: the project the dashboard's line names — the one picked with Change while it is still there */
export const namedTarget = (
  folders: FolderMeta[] | null,
  picked: string | null,
): FolderMeta | null => savableFolder(folders, picked) ?? defaultTarget(folders);

/**
 * ① the caller's folder → ② the folder the active document tab's diagram is
 * in → ③ while Home is on screen, the folder it shows — a card selected
 * there is not a place (#231 D7) → ④ the project picked with Change → ⑤ the
 * most recently edited project → ⑥ none (#229 D14: any depth).
 */
export const targetFolder = (folder?: string): string | undefined => {
  if (folder) return folder;
  const { folders } = useLibraryStore.getState();
  const { activeTab, homeView, newDiagramTarget } = useAppStore.getState();
  // a document tab on screen says where its project's next diagram goes; an
  // external file's says nothing, and Home's view is not on show (#161)
  const near =
    activeTab !== null
      ? folderOfProject(folders, useDiagramStore.getState().projectId)?.id
      : homeFolderOf(homeView, folders);
  return (savableFolder(folders, near ?? null) ?? namedTarget(folders, newDiagramTarget))?.id;
};
