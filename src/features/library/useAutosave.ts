import { useEffect } from "react";

import { useDiagramStore } from "../../shared/lib/store";
import { documentMayHaveChanged } from "../../shared/lib/store/document";
import { toastError } from "../../shared/lib/toastStore";
import { useAppStore } from "./appStore";
import {
  type FileStamp,
  type SaveOutcome,
  saveProjectContents,
  serializeProject,
} from "./libraryApi";

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
/**
 * What each open diagram's file was like when its tab last read or wrote it
 * (#253 D11) — the `base` every save brings, so Rust writes over nothing
 * someone else put there meanwhile. A preview's read leaves it alone.
 */
const baseStamps = new Map<string, FileStamp>();
/** project writes sent to disk this session — what a listing read after them is up to date with */
let writesSent = 0;
/** per diagram: its writes sent and not settled yet */
const writing = new Map<string, number>();
/**
 * Per diagram: moved on by every read of it from disk. A write queued
 * before the read is dropped — it would put back what the read replaced.
 */
const generations = new Map<string, number>();
const generationOf = (id: string): number => generations.get(id) ?? 0;
/** diagrams gone from disk since they were read — never written again until read again */
const gone = new Set<string>();
/**
 * Diagrams a save could not reach (#253): their project not found, or a
 * folder of theirs that cannot be read. Their edits stay in their tabs and
 * nothing is sent until the listing has them again (`resumeProject`) — or
 * an explicit Save gets through.
 */
const paused = new Set<string>();
/**
 * Diagrams whose save out of reach has been said already — once, until a
 * save of theirs gets through: a listing that has one again tries again,
 * and a try that fails again says nothing new.
 */
const toldUnreached = new Set<string>();

/**
 * Diagrams whose last save failed with an error — nothing known written:
 * their edits are only in their tabs until a save gets through. Unlike a
 * save out of reach, the next edit tries again.
 */
const failed = new Set<string>();

/**
 * Diagrams gone from the listing whose tab was kept when asked, for the
 * edits only it holds: not asked about again until a save of theirs gets
 * through, or their tab closes.
 */
const keptWhenGone = new Set<string>();

/** whether a tab still holds the diagram `id` — the one on screen, or one beside it */
const inATab = (id: string): boolean =>
  useDiagramStore.getState().projectId === id ||
  useAppStore.getState().tabs.some((t) => t.projectId === id);

/**
 * why a save was not written — the file changed on disk, is gone, or cannot
 * be reached (#253 D12, D13)
 */
export type SaveRefusal = "changedOnDisk" | "gone" | "unreachable";

/**
 * What a refused save does — the tabs set it (`tabActions`): read the
 * diagram again, or close its tab. Left unset, the refusal is an error toast.
 */
let refused = (_id: string, why: SaveRefusal): void => {
  toastError(
    why === "gone" ? "The diagram is gone from disk" : "The diagram changed outside Dosik",
  );
};

export const onSaveRefused = (handler: (id: string, why: SaveRefusal) => void): void => {
  refused = handler;
};

/** the title a serialized document carries */
const titleIn = (contents: string): string | undefined => {
  try {
    const title: unknown = (JSON.parse(contents) as { title?: unknown }).title;
    return typeof title === "string" ? title : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A save landed under `name`, its file's (#253 D8): the diagram takes it as
 * its title — no undo step, as a rename of the file it is — unless its title
 * has moved on since `sent` went out; the next save sees to that one. The
 * store while the diagram is on screen, else its tab's snapshot.
 */
const takeSavedName = (id: string, sent: string | undefined, name: string): void => {
  if (sent === undefined || name === sent) return;
  const live = useDiagramStore.getState();
  if (live.projectId === id) {
    if (live.title === sent) live.setTitle(name);
    return;
  }
  const { tabs, activeTab, commitTabs } = useAppStore.getState();
  const tab = tabs.find((t) => t.id !== activeTab && t.projectId === id && t.doc);
  if (!tab?.doc || tab.doc.title !== sent) return;
  commitTabs({
    tabs: tabs.map((t) =>
      t === tab && t.doc ? { ...t, title: name, doc: { ...t.doc, title: name } } : t,
    ),
    activeTab,
  });
};

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
  // gone from disk: a write would be refused, or make it again elsewhere
  if (gone.has(id)) return inFlight.then(() => false);
  // out of reach: nothing is sent until it is back — an explicit Save tries
  if (paused.has(id) && !force) return inFlight.then(() => false);
  const contents = serializeProject(useDiagramStore.getState().toDoc());
  return writeContents(id, contents, force);
};

/**
 * An inactive tab's document `doc` written for the diagram `id`, on the same
 * chain — what a tab kept beside the screen had not written yet.
 */
export const writeSnapshotThroughChain = (
  id: string,
  doc: Parameters<typeof serializeProject>[0],
): Promise<boolean> => {
  if (gone.has(id) || paused.has(id)) return inFlight.then(() => false);
  return writeContents(id, serializeProject(doc), false);
};

const writeContents = (id: string, contents: string, force: boolean): Promise<boolean> => {
  const previous = lastWritten.get(id);
  if (!force && previous === contents) return inFlight.then(() => true);
  // claimed at scheduling time, not completion: a write that takes longer than
  // the debounce must not let an edit-and-undo back to the previous bytes be
  // skipped while the stale bytes are still on their way to the file
  lastWritten.set(id, contents);
  writesSent++;
  const generation = generationOf(id);
  writing.set(id, (writing.get(id) ?? 0) + 1);
  const rollBack = () => {
    if (lastWritten.get(id) === contents) {
      if (previous === undefined) lastWritten.delete(id);
      else lastWritten.set(id, previous);
    }
  };
  // whether a refusal is told — out of reach, once until it is back; an
  // explicit Save, every time
  let tell = true;
  // the base is read as the write starts, not as it is scheduled: the one
  // before it on the chain may have moved it on
  const attempt = inFlight
    .then((): Promise<SaveOutcome | "dropped"> | "dropped" =>
      // read from disk since it was queued: what it holds is older than the tab
      generationOf(id) === generation
        ? saveProjectContents(id, contents, baseStamps.get(id))
        : "dropped",
    )
    .then(
      (outcome) => {
        // on the chain itself, so the next write starts from this stamp
        if (outcome === "dropped") return outcome;
        if (outcome.kind === "saved") {
          baseStamps.set(id, outcome.stamp);
          paused.delete(id);
          toldUnreached.delete(id);
          failed.delete(id);
          keptWhenGone.delete(id);
        } else {
          rollBack();
          if (outcome.kind === "unreachable") {
            // its tab closed meanwhile: nothing waits for it
            const open = inATab(id);
            tell = open && (force || !toldUnreached.has(id));
            if (open) {
              paused.add(id);
              toldUnreached.add(id);
            }
          }
          // gone: still held back until its tab closes — asked about first
          // when it holds edits only it has
        }
        return outcome;
      },
      (error: unknown) => {
        rollBack();
        if (inATab(id)) failed.add(id);
        throw error;
      },
    );
  const settled = () => {
    const left = (writing.get(id) ?? 1) - 1;
    if (left > 0) writing.set(id, left);
    else writing.delete(id);
  };
  // the chain itself never rejects — a failure must not take later writes down
  inFlight = attempt.then(settled, settled);
  return attempt.then(
    (outcome) => {
      if (outcome === "dropped") return true;
      if (outcome.kind === "saved") {
        takeSavedName(id, titleIn(contents), outcome.name);
        return true;
      }
      if (tell) refused(id, outcome.kind);
      return false;
    },
    (error) => {
      // no retry: the next edit schedules the next attempt. The caller gets
      // `false` so an explicit Save can refrain from claiming success
      toastError(error);
      return false;
    },
  );
};

/**
 * What a freshly opened, created or read-again project's file holds — so the
 * first no-op change is not written — and its stamp, the base of its next
 * save (none known: the next save writes without one).
 */
export const noteProjectContents = (
  id: string,
  doc: Parameters<typeof serializeProject>[0],
  stamp?: FileStamp,
): void => {
  lastWritten.set(id, serializeProject(doc));
  if (stamp === undefined) baseStamps.delete(id);
  else baseStamps.set(id, stamp);
  generations.set(id, generationOf(id) + 1);
  gone.delete(id);
  paused.delete(id);
  toldUnreached.delete(id);
  failed.delete(id);
  keptWhenGone.delete(id);
};

/** the stamp the next save of `id` brings as its base — what its tab last saw */
export const baseStampOf = (id: string): FileStamp | undefined => baseStamps.get(id);

/**
 * Whether the diagram `id`, as `doc` holds it, has edits its file may not
 * have yet (#253 D12): a write waiting to go, one on its way, or bytes no
 * write has carried.
 */
export const hasUnwrittenEdits = (
  id: string,
  doc: Parameters<typeof serializeProject>[0],
): boolean =>
  pending === id || (writing.get(id) ?? 0) > 0 || lastWritten.get(id) !== serializeProject(doc);

/**
 * The diagram `id` is gone from disk (#253 D13): nothing pending or queued
 * for it is written — a write would only be refused, or make it again.
 */
export const forgetProject = (id: string): void => {
  if (pending === id) discardPendingAutosave();
  gone.add(id);
  paused.delete(id);
  toldUnreached.delete(id);
  failed.delete(id);
  keptWhenGone.delete(id);
  generations.set(id, generationOf(id) + 1);
  lastWritten.delete(id);
  baseStamps.delete(id);
};

/** the diagrams whose saves wait for their project to be reached again */
export const pausedProjects = (): string[] => [...paused];

/**
 * Whether the saves of the diagram `id` are held back — waiting for it to
 * be reached, or the last one failed: what its tab holds may be nowhere else.
 */
export const savesHeldBack = (id: string): boolean => paused.has(id) || failed.has(id);

/** whether the last save of the diagram `id` failed with an error */
export const lastSaveFailed = (id: string): boolean => failed.has(id);

/**
 * Resolves once every write sent so far has its answer — what a look at the
 * disk waits for, so the app's own write is not taken for someone else's.
 */
export const writesLanded = (): Promise<void> => inFlight;

/** the diagram `id` can be reached again: its saves go on */
export const resumeProject = (id: string): void => {
  paused.delete(id);
};

/** the diagram `id` is in no tab any more: its saves wait for nothing */
export const stopWaiting = (id: string): void => {
  paused.delete(id);
  toldUnreached.delete(id);
  failed.delete(id);
  keptWhenGone.delete(id);
};

/** the diagram `id`, gone from the listing, keeps its tab: the user said so */
export const keepWhenGone = (id: string): void => {
  keptWhenGone.add(id);
};

/** whether the diagram `id` was kept when it went from the listing, and asked about */
export const isKeptWhenGone = (id: string): boolean => keptWhenGone.has(id);

/**
 * The saves of the diagram `id` wait from now — its file gone, its tab kept
 * for the edits only it holds: nothing is sent on its own, an explicit Save
 * still tries, and a listing that has it again lets them go on.
 */
export const holdSaves = (id: string): void => {
  paused.add(id);
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
  baseStamps.clear();
  writing.clear();
  generations.clear();
  gone.clear();
  paused.clear();
  toldUnreached.clear();
  failed.clear();
  keptWhenGone.clear();
  writesSent = 0;
};
