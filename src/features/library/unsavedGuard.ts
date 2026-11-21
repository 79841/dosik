import { ask } from "@tauri-apps/plugin-dialog";

import { useDiagramStore } from "../../shared/lib/store";
import { documentFile } from "../../shared/lib/store/document";
import type { DocSnapshot } from "../../shared/lib/store/tabs";
import { serializeProject } from "./libraryApi";

/**
 * Guards the edits of an *external* file (#123). A library project is
 * autosaved, so closing it loses nothing; an external `.dosik` file (Open…)
 * is written only on Save. Since tabs (#218 D8) nothing but closing — its
 * tab, or the window — drops a document, so that is where this asks. The
 * baseline is the serialized document as it was last known to match the
 * file — comparing bytes (as autosave does) means selection and measurement
 * churn never counts as a change.
 */
let baseline: string | null = null;

const snapshot = (): string => serializeProject(useDiagramStore.getState().toDoc());

/**
 * The document was just read from its file (no argument: the store *is* the
 * file now) or written to it — then pass the bytes that were written. Save
 * awaits the disk, and an edit that lands meanwhile (a bridge op, a drag on
 * a slow volume) is not in the file; a post-write snapshot would call it saved.
 */
export const markExternalSaved = (written?: string): void => {
  baseline = written ?? snapshot();
};

export const resetUnsavedGuardForTests = (): void => {
  baseline = null;
};

export const hasUnsavedExternalChanges = (): boolean => {
  const state = useDiagramStore.getState();
  if (state.filePath === null || state.projectId !== null) return false;
  return snapshot() !== baseline;
};

/**
 * The baseline of the document on screen. Each tab keeps its own (#218 D8):
 * a tab takes it when it is left and puts it back when it returns — the
 * `filePath` subscription below has moved it to whatever was opened since.
 */
export const externalBaseline = (): string | null => baseline;

export const setExternalBaseline = (bytes: string | null): void => {
  baseline = bytes;
};

/** whether a tab not on screen holds edits its external file does not have (D8) */
export const isUnsavedSnapshot = (snapshot: DocSnapshot, bytes: string | null): boolean =>
  snapshot.filePath !== null &&
  snapshot.projectId === null &&
  serializeProject(documentFile(snapshot)) !== bytes;

const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;

/**
 * Asks once whether to drop the unsaved edits of these files — one file in
 * the words #123 used, several (closing the window) in one question (D8).
 * `true`: nothing to lose, or the user chose to discard.
 */
export const askDiscard = async (paths: readonly string[]): Promise<boolean> => {
  if (paths.length === 0) return true;
  const names = paths.map((p) => `“${fileName(p)}”`);
  const message =
    paths.length === 1
      ? `${names[0]} has unsaved changes. Discard them?`
      : `${paths.length} files have unsaved changes — ${names.join(", ")}. Discard them?`;
  return ask(message, {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
};

// A *new* file path means the document is that file by definition (Open of
// another path, Home's blank, Save As). Re-opening the same path and Save to
// the same path change no field the store exposes, so opening a file
// (`tabActions.openDocument`) and the toolbar's Save (`noteSavedToFile`) call
// `markExternalSaved` directly.
// `docVersion` is deliberately not watched: the bridge's set_diagram bumps it
// too, and that is an edit relative to the file, not a load from it.
// No dispose: an HMR re-evaluation stacks a duplicate subscription (idempotent,
// same class as canvasUiStore's) and resets `baseline` to null, so the first
// exit after an HMR of this module asks once too often — dev only, safe side.
useDiagramStore.subscribe((state, prev) => {
  if (state.filePath !== prev.filePath) markExternalSaved();
});
