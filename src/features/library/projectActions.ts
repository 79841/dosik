import { useDiagramStore } from "../../shared/lib/store";
import { pickDiagramPath } from "../export/file";
import { useAppStore } from "./appStore";
import { libraryDiagramAt } from "./libraryApi";
import { refreshLibraryQuietly } from "./libraryStore";
import { openLibraryDiagram, openPathInTab } from "./tabActions";
import { discardPendingAutosave, writeProjectThroughChain } from "./useAutosave";

/**
 * What the toolbar and Open… add on top of the tab module (#218): every
 * other move between Home and documents is `tabActions`' own, called
 * straight from `navigation`, the bridge and the OS's open requests.
 */

/**
 * Opens a `.dosik` file the user picks. A file of a project of the library
 * opens as that library diagram, by the id Rust finds (#253 D16) —
 * autosaved, in the tree; any other stays external — not autosaved, not
 * listed. Resolves where a tab opened just now went: on screen, or
 * `"beside"` it when the user went elsewhere while it was read (#218). A
 * cancel, or a file that was open already (its tab comes up), is `false`.
 * `navigation.openFileAnywhere` is the announced way in every Open… shares.
 */
export const openExternalFile = async (): Promise<"shown" | "beside" | false> => {
  const path = await pickDiagramPath();
  if (path === null) return false;
  const id = await libraryDiagramAt(path);
  if (id !== null) {
    const open = useAppStore.getState().tabs.some((t) => t.projectId === id);
    await openLibraryDiagram(id);
    // made just now, maybe: the tree shows it
    refreshLibraryQuietly();
    if (open) return false;
    return useDiagramStore.getState().projectId === id ? "shown" : "beside";
  }
  if (!(await openPathInTab(path))) return false;
  return useDiagramStore.getState().filePath === path ? "shown" : "beside";
};

/**
 * The toolbar's Save for a project: write now, on the same chain as autosave,
 * even if unchanged. Resolves `false` when the write failed — the error toast
 * is already up, and the caller must not also say "Saved".
 */
export const saveCurrentProjectNow = (id: string): Promise<boolean> => {
  discardPendingAutosave();
  return writeProjectThroughChain(id, true);
};
