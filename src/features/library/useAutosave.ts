import { useEffect } from "react";

import { useDiagramStore } from "../../shared/lib/store";
import { documentMayHaveChanged } from "../../shared/lib/store/document";
import { toastError } from "../../shared/lib/toastStore";
import { saveProjectContents, serializeProject } from "./libraryApi";

/** how long after the last edit the project is written */
export const AUTOSAVE_DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;
/** the project the pending write is for — captured at schedule time, not at flush */
let pending: string | null = null;
/** the write currently on its way to disk, so a flush can wait for it */
let inFlight: Promise<void> = Promise.resolve();
/**
 * What each project's file holds, as far as this session knows. React Flow
 * rewrites the node array on selection and measurement changes too, so the
 * store subscription fires for edits that change nothing in the document —
 * comparing the bytes keeps those from touching the file (and its mtime,
 * which is what Home sorts by).
 */
const lastWritten = new Map<string, string>();
/** project writes sent to disk this session — what a listing read after them is up to date with */
let writesSent = 0;

/**
 * How many project writes have been sent so far — a caller that read the
 * library after this many knows whether anything was written since.
 */
export const projectWritesSent = (): number => writesSent;

/**
 * Appends a write for `id` to the chain. Every write to a project file goes
 * through here — autosave and the toolbar's Save alike — so two writers never
 * run at once. `force` writes even when the bytes are unchanged (an explicit
 * Save should leave a fresh mtime).
 */
export const writeProjectThroughChain = (id: string, force = false): Promise<boolean> => {
  // the document is read at write time: if the store has moved on to another
  // project (or an external file) since this was scheduled, writing it under
  // the old id would put the wrong document in that project's file
  if (useDiagramStore.getState().projectId !== id) return inFlight.then(() => true);
  const contents = serializeProject(useDiagramStore.getState().toDoc());
  const previous = lastWritten.get(id);
  if (!force && previous === contents) return inFlight.then(() => true);
  // claimed at scheduling time, not completion: a write that takes longer than
  // the debounce must not let an edit-and-undo back to the previous bytes be
  // skipped while the stale bytes are still on their way to the file
  lastWritten.set(id, contents);
  writesSent++;
  const attempt = inFlight.then(() => saveProjectContents(id, contents));
  // the chain itself never rejects — a failure must not take later writes down
  inFlight = attempt.then(
    () => undefined,
    () => {
      if (lastWritten.get(id) === contents) {
        if (previous === undefined) lastWritten.delete(id);
        else lastWritten.set(id, previous);
      }
    },
  );
  return attempt.then(
    () => true,
    (error) => {
      // no retry: the next edit schedules the next attempt. The caller gets
      // `false` so an explicit Save can refrain from claiming success
      toastError(error);
      return false;
    },
  );
};

/** what a freshly opened or created project's file holds, so the first no-op change is not written */
export const noteProjectContents = (
  id: string,
  doc: Parameters<typeof serializeProject>[0],
): void => {
  lastWritten.set(id, serializeProject(doc));
};

const writeNow = (id: string): Promise<void> => writeProjectThroughChain(id).then(() => undefined);

/**
 * Writes a pending autosave right away and waits for any write already in
 * flight. Called before anything that leaves the project — going Home,
 * opening another project, closing the window — so the debounce never loses
 * the last edit, and a delete never races a write that would resurrect the file.
 */
export const flushAutosave = async (): Promise<void> => {
  if (timer) clearTimeout(timer);
  timer = null;
  const id = pending;
  pending = null;
  if (id) await writeNow(id);
  else await inFlight;
};

/** drops a pending write without performing it — for a caller about to write itself */
export const discardPendingAutosave = (): void => {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
};

const schedule = (id: string): void => {
  pending = id;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushAutosave();
  }, AUTOSAVE_DEBOUNCE_MS);
};

/**
 * Autosave for library projects (#114). Watches the document — not history
 * frames, which inspector text edits bypass — and writes 500ms after the last
 * change. Documents opened from an external file (`filePath`) are never
 * written here: the user's own files are saved only on request.
 */
export const useAutosave = (): void => {
  useEffect(
    () =>
      useDiagramStore.subscribe((state, prev) => {
        if (!state.projectId) return;
        // the swap that binds a project is not an edit of it
        if (state.projectId !== prev.projectId) return;
        if (!documentMayHaveChanged(state, prev)) {
          return;
        }
        schedule(state.projectId);
      }),
    [],
  );
};

/** test seam — drops a pending write and forgets any in-flight one */
export const resetAutosaveForTests = (): void => {
  discardPendingAutosave();
  inFlight = Promise.resolve();
  lastWritten.clear();
  writesSent = 0;
};
