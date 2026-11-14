import { useDiagramStore } from "../../shared/lib/store";
import { pickDiagramPath } from "../export/file";
import { openPathInTab } from "./tabActions";
import { discardPendingAutosave, writeProjectThroughChain } from "./useAutosave";

/**
 * What the toolbar and Open… add on top of the tab module (#218): every
 * other move between Home and documents is `tabActions`' own, called
 * straight from `navigation`, the bridge and the OS's open requests.
 */

/**
 * Opens an external `.dosik.json` the user picks. The file stays external —
 * not autosaved, not listed. Resolves where a tab opened just now went: on
 * screen, or `"beside"` it when the user went elsewhere while it was read
 * (#218). A cancel, or a file that was open already (its tab comes
 * up), is `false`. `navigation.openFileAnywhere` is the announced way in
 * every Open… shares.
 */
export const openExternalFile = async (): Promise<"shown" | "beside" | false> => {
  const path = await pickDiagramPath();
  if (path === null || !(await openPathInTab(path))) return false;
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
