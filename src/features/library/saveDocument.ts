import { commitDrafts } from "../../shared/lib/commitDrafts";
import { useDiagramStore } from "../../shared/lib/store";
import { toastError, useToastStore } from "../../shared/lib/toastStore";
import { exportFileBase } from "../export/exportActions";
import { saveTextFile } from "../export/file";
import { useAppStore } from "./appStore";
import { saveCurrentProjectNow } from "./projectActions";
import { documentOnScreen, noteSavedToFile } from "./tabActions";

/**
 * Save — the toolbar's button, shown for an external file, and ⌘S (#219 D5).
 * A library diagram is autosaved, so Save only writes it now; an external
 * file has no autosave and goes to its path, or to one the dialog picks.
 * What is being typed is saved too, and goes on being typed: the open
 * editors write what they hold and keep the focus (`commitDrafts`, #219) — nothing is blurred, so no editor closes, the focus never falls
 * to the page where Backspace deletes, and fields that are not the
 * document's (the chat, a key) are left alone.
 * The outcome is a toast: "Saved", or the error alone. Nothing on Home.
 *
 * The tabs can move while the dialog or the disk is waited on (⌘W from the
 * menu while the sheet is up, a file the OS hands over, a slow volume), so
 * the path and the saved baseline go to the document the save started for —
 * never to whatever is on screen when it lands (#218).
 */
export const saveActiveDocument = async (): Promise<void> => {
  if (useAppStore.getState().view === "home") return;
  commitDrafts();
  try {
    const { projectId, filePath, title, toDoc } = useDiagramStore.getState();
    if (projectId) {
      if (await saveCurrentProjectNow(projectId)) useToastStore.getState().pushToast("Saved");
      return;
    }
    const contents = JSON.stringify(toDoc(), null, 2);
    const from = documentOnScreen();
    const path = await saveTextFile(
      contents,
      [{ name: "Dosik Diagram", extensions: ["dosik.json"] }],
      `${exportFileBase(title)}.dosik.json`,
      filePath,
    );
    if (!path) return;
    // the bytes that went to disk, not the store after the await — an edit
    // that landed during the write is not saved
    noteSavedToFile(from, path, contents);
    useToastStore.getState().pushToast("Saved");
  } catch (error) {
    toastError(error);
  }
};
