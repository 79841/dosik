import { scratchDiagramStore, useDiagramStore } from "../../shared/lib/store";
import { documentFile } from "../../shared/lib/store/document";
import { cloneSnapshot, HISTORY_LIMIT } from "../../shared/lib/store/history";
import { revealRequestFor, revealViewport } from "../../shared/lib/store/reveal";
import { type DocSnapshot, documentPatch, takeDocument } from "../../shared/lib/store/tabs";
import { toastError, useToastStore } from "../../shared/lib/toastStore";
import type { DiagramDoc } from "../../shared/lib/types";
import { currentViewport } from "../canvas/canvasViewport";
import { readDiagramFile, readDiagramText } from "../export/file";
import { useAppStore } from "./appStore";
import { DASHBOARD, type HomeView, sameHomeView } from "./homeView";
import {
  blankDoc,
  createProject,
  type FileStamp,
  loadProjectFile,
  newProjectId,
  sameContents,
  serializeProject,
} from "./libraryApi";
import { refreshLibraryQuietly } from "./libraryStore";
import {
  cycleTarget,
  type DocSource,
  type DocTab,
  findTab,
  newTab,
  nextActiveAfterClose,
  nthTarget,
  sourceOf,
} from "./tabModel";
import { targetFolder } from "./targets";
import {
  askDiscard,
  externalBaseline,
  fileNameOf,
  hasUnsavedExternalChanges,
  isUnsavedSnapshot,
  markExternalSaved,
  setExternalBaseline,
} from "./unsavedGuard";
import {
  baseStampOf,
  flushAutosave,
  forgetProject,
  hasUnwrittenEdits,
  holdSaves,
  isKeptWhenGone,
  keepWhenGone,
  lastSaveFailed,
  noteProjectContents,
  onSaveRefused,
  pausedProjects,
  projectWritesSent,
  resumeProject,
  savesHeldBack,
  stopWaiting,
  writeProjectThroughChain,
  writeSnapshotThroughChain,
} from "./useAutosave";

/**
 * Every way a document is opened, switched to or closed (#218 D9). The
 * diagram store holds the active tab's document; switching puts the one being
 * left into its tab as a snapshot and swaps the target's in with one
 * `setState` (D1, D4). Nothing else calls `loadDoc`/`openProject` on the live
 * store — a path that did would replace the active tab's document without
 * keeping it (`documentOpenPaths.test` holds the line).
 *
 * A switch is synchronous end to end, so it can never land inside a bridge
 * batch or a chat request. The only awaits are reads from disk, and every
 * one of them looks again at the tabs once it is back.
 */

const app = () => useAppStore.getState();
const live = () => useDiagramStore.getState();

/**
 * Bumped by every change of the active tab and by every request for the
 * screen — a read of a tab or a document not read yet, a click on Home or on
 * the active tab. A read that finds it moved on yields to the newer request
 * instead of taking the screen (D15).
 */
let activationSeq = 0;

/** `projectWritesSent()` when leaving last asked for the listing */
let listedAfterWrites = 0;

/**
 * D4 ③: what is pending for the document on screen is written — serialized
 * now, so nothing waits for the disk. A library diagram's Home card, and its
 * tree row once its tab closes, go back to the listing, read before its edits,
 * so the listing is read again once the write has landed (#217) — but
 * only when something was written since leaving last asked: the flush now, or
 * an autosave that fired earlier. Leaving a diagram nobody edited reads
 * nothing, so ⌃Tab through the strip costs no listings (#218).
 */
const flushLeaving = (): void => {
  const leavingLibrary = live().projectId !== null;
  const written = flushAutosave();
  if (!leavingLibrary) return;
  void written.then(() => {
    const writes = projectWritesSent();
    if (writes === listedAfterWrites) return;
    listedAfterWrites = writes;
    refreshLibraryQuietly();
  });
};

/**
 * D4 ①: a label editor or the title field commits into the document on
 * screen — they write to the store on blur only. Before that document is
 * left, and before anything asks whether it has unsaved edits: ⌘W from the
 * menu and a middle click leave the focus where it is (#218). Save
 * does not blur: it asks the editors to write and stay open (`commitDrafts`).
 */
const commitEditing = (): void => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return;
  if (el.isContentEditable || el.matches("input, textarea, select")) el.blur();
};

/**
 * D4 ①–④ for the tab on screen: the tab list with it kept as a snapshot —
 * its document, where its canvas was, its external file's baseline. The
 * autosave flush serializes the bytes now, so nothing waits for the disk.
 * Home has nothing to keep.
 */
const keepActive = (): DocTab[] => {
  const { tabs, activeTab } = app();
  if (activeTab === null) return tabs;
  commitEditing();
  const viewport = currentViewport();
  flushLeaving();
  const state = live();
  const doc = takeDocument(state);
  return tabs.map((tab) =>
    tab.id === activeTab
      ? {
          ...tab,
          doc,
          projectId: state.projectId,
          filePath: state.filePath,
          title: state.title,
          viewport: viewport ?? tab.viewport,
          baseline: externalBaseline(),
        }
      : tab,
  );
};

/** D4 ⑦: the list and the active tab — `view` follows in the same set */
const commit = (tabs: DocTab[], activeTab: string | null, homeView?: HomeView, focus?: boolean) => {
  activationSeq++;
  app().commitTabs({ tabs, activeTab, homeView, focus });
};

/**
 * D4 ⑤–⑦: `target`'s document — its snapshot `doc` — on screen in one set,
 * then its own external baseline, then `tabs` with it active and its
 * snapshot handed to the store.
 */
const bringIn = (tabs: DocTab[], target: DocTab, doc: DocSnapshot) => {
  const reveal = target.viewport ? revealViewport(target.viewport) : revealRequestFor(doc.nodes);
  useDiagramStore.setState(documentPatch(doc, live(), reveal));
  // the filePath subscription has just set the baseline to the incoming
  // document as it is; a dirty tab's is what its file holds (D8)
  setExternalBaseline(target.baseline);
  commit(
    tabs.map((t) => (t.id === target.id ? { ...t, doc: null } : t)),
    target.id,
  );
};

/**
 * A file read into a store of its own, so a broken one throws before anything
 * on screen changes (D4) — and the live store sees one set, never a
 * half-loaded document an autosave or a bridge read could catch.
 */
const prepare = (doc: DiagramDoc, source: DocSource): DocSnapshot => {
  const scratch = scratchDiagramStore();
  if ("projectId" in source) scratch.getState().openProject(source.projectId, doc);
  else scratch.getState().loadDoc(doc, source.filePath);
  return takeDocument(scratch.getState());
};

/**
 * Home's document (D3): a blank that lives nowhere — autosave is off, the
 * bridge sees no project, a chat turn stops.
 */
const showBlank = () => {
  const scratch = scratchDiagramStore();
  scratch.getState().loadDoc(blankDoc(), null);
  const doc = takeDocument(scratch.getState());
  useDiagramStore.setState(documentPatch(doc, live(), revealRequestFor(doc.nodes)));
};

const findOpen = (source: DocSource): DocTab | undefined => {
  const { projectId, filePath } = live();
  return findTab(app().tabs, app().activeTab, { projectId, filePath }, source);
};

/**
 * The Home tab, showing `view` (#220 D1) — `undefined`: the Home last on
 * show. The document tabs stay as they are (D3, #217 D1 replaced). `focus`:
 * the move was made inside Home's sheet, so its heading takes focus (#220 D16).
 */
export const showHomeTab = (view?: HomeView, focus = false): void => {
  const { activeTab, homeView } = app();
  const next = view ?? homeView;
  if (activeTab === null) {
    // still a request: a read under way does not take the screen from it (#218)
    activationSeq++;
    if (!sameHomeView(next, homeView) || focus) app().setHomeView(next, focus);
    return;
  }
  const tabs = keepActive();
  showBlank();
  commit(tabs, null, next, focus);
};

/** per tab: a read already under way, so a second click joins it */
const reading = new Map<string, Promise<void>>();

/** the list changed where the screen is not — the active tab stays */
const editList = (change: (tabs: DocTab[]) => DocTab[]) => {
  const { tabs, activeTab } = app();
  app().commitTabs({ tabs: change(tabs), activeTab });
};

const patchTab = (id: string, patch: Partial<DocTab>) =>
  editList((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)));

const dropFromList = (id: string) => editList((tabs) => tabs.filter((t) => t.id !== id));

/**
 * per tab being read: the `activationSeq` of the last request for it — the
 * read that started it or a click that joined it since
 */
const wanted = new Map<string, number>();

const isOpen = (id: string): boolean => app().tabs.some((t) => t.id === id);

/**
 * A restored tab is read the first time it is activated (D15). The newest
 * request wins: an activation, a click on Home or on the active tab, or
 * another read that came after the last request for this tab leaves it with
 * what was read, where it is; a click on it while it is read (or a close that
 * hands over to it) is a request too, and joins the read under way. A diagram
 * that cannot be read anymore leaves the strip.
 */
const readThenActivate = (tab: DocTab, projectId: string): Promise<void> => {
  // a read is a request for the screen too: one already under way yields to it
  wanted.set(tab.id, ++activationSeq);
  const running = reading.get(tab.id);
  if (running) return running;
  const job = (async () => {
    patchTab(tab.id, { loading: true });
    let doc: DocSnapshot;
    let stamp: FileStamp | undefined;
    try {
      const loaded = await loadProjectFile(projectId);
      doc = prepare(loaded.doc, { projectId });
      stamp = loaded.stamp;
    } catch {
      if (!isOpen(tab.id)) return;
      dropFromList(tab.id);
      useToastStore.getState().pushToast(`Couldn't reopen “${tab.title}”`);
      return;
    }
    if (!isOpen(tab.id)) return;
    noteProjectContents(projectId, documentFile(doc), stamp);
    patchTab(tab.id, { doc, loaded: true, loading: false, title: doc.title });
    // outside the read's try: a switch that fails now is not "couldn't reopen",
    // and the tab keeps what was read
    if (activationSeq === wanted.get(tab.id)) activateLoaded(tab.id);
  })().finally(() => {
    reading.delete(tab.id);
    wanted.delete(tab.id);
  });
  reading.set(tab.id, job);
  return job;
};

/** a read tab on screen — D4 in full, no await */
const activateLoaded = (id: string) => {
  const tabs = keepActive();
  const target = tabs.find((t) => t.id === id);
  if (target?.doc) bringIn(tabs, target, target.doc);
};

/**
 * Puts tab `id` on screen (`null`: Home). A tab already read switches at
 * once — the state has changed before this returns; one restored and not
 * read yet is read first.
 */
export const activateTab = async (id: string | null): Promise<void> => {
  const { tabs, activeTab } = app();
  if (id === null) return showHomeTab();
  if (id === activeTab) {
    // staying is a request too — a read under way yields to it
    activationSeq++;
    return;
  }
  const target = tabs.find((t) => t.id === id);
  if (!target) return;
  // only a library tab is ever restored unread (D15)
  if (!target.loaded && target.projectId !== null) {
    return readThenActivate(target, target.projectId);
  }
  activateLoaded(id);
};

/** an open document's tab on screen (D19) */
const switchToOpen = (open: DocTab): Promise<void> => activateTab(open.id);

/**
 * Opens a document already read: its tab if it is open (D9 — switch, no
 * re-read), else a new tab at the end, active. `opened` says which. A broken
 * document throws before anything changes. `stamp`: a library diagram's
 * file as it was read or written (#253 D11).
 */
export const openDocument = (
  doc: DiagramDoc,
  source: DocSource,
  stamp?: FileStamp,
): { tab: string; opened: boolean } => {
  const open = findOpen(source);
  if (open) {
    switchToOpen(open).catch(toastError);
    return { tab: open.id, opened: false };
  }
  const snapshot = prepare(doc, source);
  const tabs = keepActive();
  const { projectId, filePath, title } = snapshot;
  const tab = newTab({ projectId, filePath, title });
  useDiagramStore.setState(documentPatch(snapshot, live(), revealRequestFor(snapshot.nodes)));
  // opening is not an edit: what the store holds now is what the file holds
  if ("projectId" in source) noteProjectContents(source.projectId, documentFile(snapshot), stamp);
  else markExternalSaved();
  commit([...tabs, tab], tab.id);
  return { tab: tab.id, opened: true };
};

/**
 * A document read from disk for the request numbered `seq`: opened as
 * `openDocument` opens it while no newer request has come. Otherwise the
 * newer one keeps the screen and this gets its tab at the end, read, where it
 * is — the rule a restored tab's read follows (D15, #218).
 */
const openWhenRead = (
  doc: DiagramDoc,
  source: DocSource,
  seq: number,
  stamp?: FileStamp,
): { tab: string; opened: boolean } => {
  if (activationSeq === seq) return openDocument(doc, source, stamp);
  const open = findOpen(source);
  if (open) return { tab: open.id, opened: false };
  const snapshot = prepare(doc, source);
  const file = documentFile(snapshot);
  const { projectId, filePath, title } = snapshot;
  const tab: DocTab = { ...newTab({ projectId, filePath, title }), doc: snapshot };
  // opening is not an edit, on screen or not
  if ("projectId" in source) noteProjectContents(source.projectId, file, stamp);
  else tab.baseline = serializeProject(file);
  editList((tabs) => [...tabs, tab]);
  return { tab: tab.id, opened: true };
};

/** per diagram: a library read under way — a double-click's second click joins it */
const openingLibrary = new Map<string, Promise<void>>();

/** per diagram being read to open: the `activationSeq` of the last request for it */
const openWanted = new Map<string, number>();

/**
 * A library diagram. Already open: its tab, not read again (D19). Reading it
 * is a request for the screen; a request that comes after the last one for
 * it leaves it in its tab, not on screen.
 */
export const openLibraryDiagram = async (id: string): Promise<void> => {
  const open = findOpen({ projectId: id });
  if (open) return switchToOpen(open);
  openWanted.set(id, ++activationSeq);
  const running = openingLibrary.get(id);
  if (running) return running;
  const job = (async () => {
    const { doc, stamp } = await loadProjectFile(id);
    openWhenRead(doc, { projectId: id }, openWanted.get(id) ?? -1, stamp);
  })();
  openingLibrary.set(id, job);
  try {
    await job;
  } finally {
    openingLibrary.delete(id);
    openWanted.delete(id);
  }
};

/**
 * An external file at `path` — the OS's (#149) or a picked one. Already open:
 * its tab, not read again. Resolves whether a tab was opened just now — on
 * screen, or beside it when a newer request came while it was read.
 */
export const openPathInTab = async (path: string): Promise<boolean> => {
  const open = findOpen({ filePath: path });
  if (open) {
    await activateTab(open.id);
    return false;
  }
  const seq = ++activationSeq;
  const doc = await readDiagramFile(path);
  return openWhenRead(doc, { filePath: path }, seq).opened;
};

/**
 * New diagram (+, ⌘T, ⌘N, the toolbar, the tree — D11; Home's START and
 * From Mermaid… with a first document of their own — #220 D7): saved into the
 * library where `targetFolder` says, then opened in a new tab — titled what
 * its file was called, " 2" and all (#253 D8). It always takes the screen,
 * newer request or not: the bridge's Home path applies its ops to the store
 * right after. Resolves its id and the folder it went to (`undefined`:
 * Rust's choice, an empty library).
 */
export const newDiagramTab = async (
  folder?: string,
  doc: DiagramDoc = blankDoc(),
): Promise<{ id: string; folder: string | undefined }> => {
  const target = targetFolder(folder);
  const id = newProjectId();
  const outcome = await createProject(id, doc, target);
  // a new id names no file yet: nothing on disk can refuse it
  if (outcome.kind !== "saved") throw new Error("the diagram could not be made");
  const named = { ...doc, title: outcome.name };
  openDocument(named, { projectId: id }, outcome.stamp);
  refreshLibraryQuietly();
  // the folder it went to — the listing may not name the new diagram for a
  // while, so a caller making another one next can say where (#229)
  return { id, folder: target };
};

/** the external file a tab would lose edits of on closing, if any (D8) */
const unsavedPath = (tab: DocTab): string | null => {
  if (tab.id === app().activeTab) return hasUnsavedExternalChanges() ? live().filePath : null;
  return tab.doc && isUnsavedSnapshot(tab.doc, tab.baseline) ? tab.doc.filePath : null;
};

/**
 * Whether a library tab holds edits its save could not reach (#253): its
 * project out of reach, the saves waiting for it, or its last save failed
 * — only the tab has them, as an external file's tab has what its file lacks.
 */
const holdsUnreachedEdits = (tab: DocTab): boolean => {
  const { projectId } = sourceOf(tab, app().activeTab, live());
  if (projectId === null) return false;
  if (!savesHeldBack(projectId) && !isKeptWhenGone(projectId)) return false;
  const doc = tab.id === app().activeTab ? live() : tab.doc;
  return doc !== null && hasUnwrittenEdits(projectId, documentFile(doc));
};

/**
 * The library diagrams of a close under way — a tab's, the window's, a
 * project leaving the library: a save of one found gone meanwhile is asked
 * about by that close's own question, not by a second one (`gone`). Those
 * found gone so, by the close that saw it.
 */
const closing = new Map<string, boolean>();

/**
 * Runs the close `ask` for the library diagrams `ids` — their saves flushed
 * and tried once more inside it — one question in all. After a Cancel, one
 * found gone meanwhile is kept, as when asked on its own, when its tab
 * holds edits only it has; else its tab closes as removed.
 */
const asClose = async (ids: readonly string[], ask: () => Promise<boolean>): Promise<boolean> => {
  const mine = ids.filter((id) => !closing.has(id));
  for (const id of mine) closing.set(id, false);
  let discard = false;
  let seen: string[] = [];
  try {
    discard = await ask();
  } finally {
    seen = mine.filter((id) => closing.get(id));
    for (const id of mine) closing.delete(id);
  }
  if (!discard && seen.length > 0) {
    const { tabs } = app();
    const holding = new Set(libraryIdsOf(tabs.filter(holdsUnreachedEdits)));
    const open = new Set(libraryIdsOf(tabs));
    for (const id of seen) if (holding.has(id)) keepTab(id);
    const removed = seen.filter((id) => open.has(id) && !holding.has(id));
    if (removed.length > 0) await closeRemovedDiagrams(new Set(removed));
  }
  return discard;
};

/** the library diagrams of these tabs */
const libraryIdsOf = (tabs: readonly DocTab[]): string[] => {
  const { activeTab } = app();
  return tabs.flatMap((t) => {
    const { projectId } = sourceOf(t, activeTab, live());
    return projectId === null ? [] : [projectId];
  });
};

/**
 * The saves that failed for these tabs, tried once more — before a question
 * about their edits: a disk back meanwhile leaves nothing to ask about.
 */
const retryFailedSaves = async (tabs: readonly DocTab[]): Promise<void> => {
  const { activeTab } = app();
  const tries = tabs.flatMap((t) => {
    const { projectId } = sourceOf(t, activeTab, live());
    if (projectId === null || !lastSaveFailed(projectId)) return [];
    if (t.id === activeTab) return [writeProjectThroughChain(projectId)];
    return t.doc ? [writeSnapshotThroughChain(projectId, documentFile(t.doc))] : [];
  });
  await Promise.all(tries);
};

/**
 * What a tab would lose on closing, by the name its question shows — an
 * external file's name (D8), a library diagram's title — if anything.
 */
const unsavedName = (tab: DocTab): string | null => {
  const path = unsavedPath(tab);
  if (path !== null) return fileNameOf(path);
  return holdsUnreachedEdits(tab) ? titleOf(tab) : null;
};

/**
 * Takes tab `id` off the strip without asking. The active one's pending
 * autosave is written first (serialized now), then the right neighbour, the
 * left one or Home takes over (D10).
 */
const dropTab = (id: string) => {
  const { tabs, activeTab } = app();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  // nothing of it is saved from here: its saves wait for nothing any more
  const { projectId } = sourceOf(tab, activeTab, live());
  if (id !== activeTab) {
    dropFromList(id);
    if (projectId !== null) stopWaiting(projectId);
    return;
  }
  commitEditing();
  flushLeaving();
  if (projectId !== null) stopWaiting(projectId);
  const next = nextActiveAfterClose(tabs, activeTab, id);
  const rest = tabs.filter((t) => t.id !== id);
  const target = rest.find((t) => t.id === next);
  if (target?.doc) {
    bringIn(rest, target, target.doc);
    return;
  }
  showBlank();
  commit(rest, null);
  // a neighbour restored and not read yet is read now; Home shows meanwhile
  if (target) activateTab(target.id).catch(toastError);
};

/**
 * Closes tab `id` (×, ⌘W, middle click — D10). A library diagram goes at
 * once; an external file with unsaved edits asks first, and so does a
 * library diagram holding edits its project's absence kept from its file
 * (#253). Resolves whether it closed — not after a Cancel, nor when it was
 * closed while the dialog was up.
 */
export const closeTab = async (id: string): Promise<boolean> => {
  const first = app().tabs.find((t) => t.id === id);
  if (!first) return false;
  // what is typed into the tab on screen counts — and a Cancel keeps it
  if (id === app().activeTab) commitEditing();
  const go = await asClose(libraryIdsOf([first]), async () => {
    // an edit waiting for its autosave is sent first: a save that cannot
    // reach its diagram is found out before the question — and one that
    // failed is tried once more
    await flushAutosave();
    const open = app().tabs.find((t) => t.id === id);
    if (!open) return false;
    await retryFailedSaves([open]);
    const tab = app().tabs.find((t) => t.id === id);
    if (!tab) return false;
    const unsaved = unsavedName(tab);
    if (unsaved === null) return true;
    return (await askDiscard([unsaved])) && isOpen(id);
  });
  if (!go || !isOpen(id)) return false;
  dropTab(id);
  return true;
};

/** ⌘W (D12): the active document tab; `false` on Home, where there is none */
export const closeActiveTab = (): Promise<boolean> => {
  const { activeTab } = app();
  return activeTab === null ? Promise.resolve(false) : closeTab(activeTab);
};

/**
 * Closes the tabs of these library diagrams without asking — they are about
 * to be deleted (D20). The inactive ones first, so the active one hands over
 * to a tab that stays.
 */
export const closeDiagramTabs = (projectIds: ReadonlySet<string>): void => {
  const { tabs, activeTab } = app();
  const doomed = tabs.filter((t) => {
    const { projectId } = sourceOf(t, activeTab, live());
    return projectId !== null && projectIds.has(projectId);
  });
  for (const tab of doomed.filter((t) => t.id !== activeTab)) dropTab(tab.id);
  if (doomed.some((t) => t.id === activeTab) && activeTab !== null) dropTab(activeTab);
};

/** ⌃Tab / ⌃⇧Tab (D12) */
export const cycleTab = (dir: 1 | -1): Promise<void> =>
  activateTab(cycleTarget(app().tabs, app().activeTab, dir));

/** ⌘1–⌘9 (D12); a number with no tab does nothing */
export const activateNth = (n: number): Promise<void> => {
  const target = nthTarget(app().tabs, n);
  return target === undefined ? Promise.resolve() : activateTab(target);
};

/** the document a write that awaits the disk was started for — the toolbar's Save */
export interface DocumentOnScreen {
  /** its tab; `null` when Home's blank was on screen */
  tab: string | null;
  /** the store's `docSession` then — every swap moves it on (D17) */
  session: number;
}

export const documentOnScreen = (): DocumentOnScreen => ({
  tab: app().activeTab,
  session: live().docSession,
});

/**
 * A Save landed: the file at `path` holds `written` (#123). The tabs may have
 * moved while it waited on the dialog or the disk, so the path and the
 * baseline go to the document it was started for — the store while that is
 * still on screen (or on screen again), else its tab's record — never to
 * whatever is on screen now. A tab closed meanwhile takes nothing.
 */
export const noteSavedToFile = (from: DocumentOnScreen, path: string, written: string): void => {
  const { activeTab } = app();
  if (live().docSession === from.session || (from.tab !== null && from.tab === activeTab)) {
    live().setFilePath(path);
    // the bytes that went to disk, not the store now — an edit that landed
    // during the write is not saved (and Save to the same path changes no
    // field the guard's subscription watches)
    markExternalSaved(written);
    return;
  }
  const tab = app().tabs.find((t) => t.id === from.tab);
  if (!tab) return;
  patchTab(tab.id, {
    filePath: path,
    doc: tab.doc && { ...tab.doc, filePath: path },
    baseline: written,
  });
};

/**
 * every tab — on screen or not — with edits only it holds, by the name its
 * question shows: an external file's its file does not have (D8), a library
 * diagram's its save could not reach (#253)
 */
const unsavedTabNames = (tabs: readonly DocTab[] = app().tabs): string[] =>
  tabs.map(unsavedName).filter((n): n is string => n !== null);

/**
 * Closing the window: one question for all of them; `false` keeps the window
 * (T35). What is being typed is committed first, so it is asked about — and a
 * library diagram's autosave, flushed next, writes it.
 */
export const confirmDiscardTabs = async (): Promise<boolean> => {
  commitEditing();
  return asClose(libraryIdsOf(app().tabs), async () => {
    // a save that cannot reach its diagram is found out before the
    // question, and one that failed is tried once more
    await flushAutosave();
    await retryFailedSaves(app().tabs);
    return askDiscard(unsavedTabNames());
  });
};

/**
 * Before the tabs of these library diagrams close for good — their project
 * leaves the library (#253 D9): one question for the ones holding edits
 * their save could not reach. `false`: keep them.
 */
export const confirmDiscardDiagramTabs = async (
  projectIds: ReadonlySet<string>,
): Promise<boolean> => {
  commitEditing();
  const ofThem = (t: DocTab) => {
    const { projectId } = sourceOf(t, app().activeTab, live());
    return projectId !== null && projectIds.has(projectId);
  };
  return asClose([...projectIds], async () => {
    await flushAutosave();
    await retryFailedSaves(app().tabs.filter(ofThem));
    return askDiscard(unsavedTabNames(app().tabs.filter(ofThem)));
  });
};

/**
 * The session's active diagram, once the app is up (D15): read and shown,
 * unless something else took the screen first — a file the OS handed over,
 * a bridge op on Home — or meanwhile.
 */
export const restoreActiveTab = async (projectId: string | null): Promise<void> => {
  if (projectId === null || app().activeTab !== null) return;
  const tab = app().tabs.find((t) => t.projectId === projectId && !t.loaded);
  if (tab) await activateTab(tab.id);
};

/** library tabs not read yet whose diagram a successful listing no longer has (D15) */
export const pruneUnlisted = (listed: ReadonlySet<string>): void => {
  const { tabs } = app();
  const gone = tabs.filter((t) => !t.loaded && t.projectId !== null && !listed.has(t.projectId));
  for (const tab of gone) {
    if (!reading.has(tab.id)) dropFromList(tab.id);
  }
};

/*
 * Changes made outside the app (#253 D12, D13). A tab whose file changed is
 * read again — quietly when it had no edits of its own the file lacks, with
 * a toast when it had (the file wins). Either way it is one undo step: ⌘Z
 * brings back what the tab showed. The canvas stays where it was. A tab
 * whose file went is closed, with a toast.
 */

/** a tab's document as the file and the bridge carry it */
const fileBytes = (doc: Pick<DocSnapshot, "title" | "nodes" | "edges">): string =>
  serializeProject(documentFile(doc));

/** the read tab showing `source` — the active one or one kept as a snapshot */
const readTab = (source: DocSource): DocTab | undefined => {
  const { tabs, activeTab } = app();
  return tabs.find((t) => {
    if (t.id !== activeTab && !t.doc) return false;
    const at = sourceOf(t, activeTab, live());
    return "projectId" in source
      ? at.projectId === source.projectId
      : at.filePath === source.filePath;
  });
};

/**
 * Puts `fresh` — the file as it is now — into tab `id`: the store while it
 * is on screen, its snapshot else. One undo step, the canvas where it was.
 * Resolves whether the document changed.
 */
const takeFromDisk = (id: string, fresh: DocSnapshot): boolean => {
  if (id === app().activeTab) {
    const state = live();
    if (fileBytes(state) === fileBytes(fresh)) return false;
    state.commit();
    useDiagramStore.setState({
      title: fresh.title,
      nodes: fresh.nodes,
      edges: fresh.edges,
      // id-keyed state of the document it replaced, as a load clears it
      touched: {},
      editRequestId: null,
      enteredGroup: null,
      groupResizing: null,
      // open editors and menus close; the canvas stays (no reveal)
      docVersion: state.docVersion + 1,
    });
    return true;
  }
  const tab = app().tabs.find((t) => t.id === id);
  if (!tab?.doc || fileBytes(tab.doc) === fileBytes(fresh)) return false;
  const past = [...tab.doc.past.slice(-HISTORY_LIMIT + 1), cloneSnapshot(tab.doc)];
  patchTab(id, {
    title: fresh.title,
    doc: {
      ...tab.doc,
      title: fresh.title,
      nodes: fresh.nodes,
      edges: fresh.edges,
      past,
      future: [],
      enteredGroup: null,
    },
  });
  return true;
};

const toast = (text: string) => useToastStore.getState().pushToast(text);
const changedToast = (title: string) => toast(`“${title}” changed outside Dosik — reloaded`);
const removedToast = (title: string) => toast(`“${title}” was removed outside Dosik`);

/** the title a tab shows — the store's while it is on screen */
const titleOf = (tab: DocTab): string => (tab.id === app().activeTab ? live().title : tab.title);

/**
 * The library diagrams whose save was refused as changed on disk while their
 * file could not be read — told once, until a read of it gets through.
 */
const unreadableAfterRefusal = new Set<string>();

/**
 * The library diagram `projectId` read again from disk, in its tab if one
 * has it read. Nothing when its file is as the tab last saw it — unless a
 * save of it was just refused (`refused`): its edits are not on disk, and
 * the file wins. A file that cannot be read now is left to the listing —
 * unless a save was refused for it: then nothing is saved until it can be,
 * which a toast says, once while it lasts.
 */
export const reloadDiagram = async (projectId: string, refused = false): Promise<void> => {
  if (!readTab({ projectId })) return;
  let loaded: Awaited<ReturnType<typeof loadProjectFile>>;
  try {
    loaded = await loadProjectFile(projectId);
  } catch {
    const tab = readTab({ projectId });
    if (refused && tab && !unreadableAfterRefusal.has(projectId)) {
      unreadableAfterRefusal.add(projectId);
      toastError(`“${titleOf(tab)}” changed outside Dosik and can't be read — not saved`);
    }
    return;
  }
  unreadableAfterRefusal.delete(projectId);
  const tab = readTab({ projectId });
  if (!tab) return;
  if (!refused && sameContents(loaded.stamp, baseStampOf(projectId))) return;
  const fresh = prepare(loaded.doc, { projectId });
  const current = tab.id === app().activeTab ? live() : tab.doc;
  const unwritten =
    refused || (current !== null && hasUnwrittenEdits(projectId, documentFile(current)));
  noteProjectContents(projectId, documentFile(fresh), loaded.stamp);
  if (takeFromDisk(tab.id, fresh) && unwritten) changedToast(fresh.title);
};

/**
 * The tab of the library diagram `id`, gone from disk, kept when asked for
 * the edits only it holds: not asked about again, and nothing of it saved
 * on its own — its file is gone — until a listing has it again.
 */
const keepTab = (id: string): void => {
  keepWhenGone(id);
  holdSaves(id);
};

/**
 * Closes the tabs of these library diagrams — gone from disk (#253 D13) —
 * with a toast each. What was pending for them is dropped, never written:
 * that would make the file again. A tab holding edits a save could not
 * reach — only it has them — asks first, as on closing it: kept, it stays,
 * edits and all, and is not asked about again until a save of it gets
 * through or it is closed.
 */
export const closeRemovedDiagrams = async (projectIds: ReadonlySet<string>): Promise<void> => {
  const idOf = (t: DocTab) => sourceOf(t, app().activeTab, live()).projectId;
  const theirs = () =>
    app().tabs.filter((t) => {
      const projectId = idOf(t);
      return projectId !== null && projectIds.has(projectId);
    });
  const holding = theirs().filter(holdsUnreachedEdits);
  // kept when asked before: left be, not asked again
  const kept = new Set(holding.map(idOf).filter((id) => id !== null && isKeptWhenGone(id)));
  const asking = holding.filter((t) => !kept.has(idOf(t)));
  if (asking.length > 0 && !(await askDiscard(asking.map(titleOf)))) {
    for (const tab of asking) {
      const id = idOf(tab);
      if (id === null) continue;
      keepTab(id);
      kept.add(id);
    }
  }
  const gone = theirs().filter((t) => !kept.has(idOf(t)));
  if (gone.length === 0) return;
  const removed = new Set(gone.map((t) => idOf(t) as string));
  const titles = gone.map(titleOf);
  for (const id of removed) {
    forgetProject(id);
    unreadableAfterRefusal.delete(id);
  }
  closeDiagramTabs(removed);
  for (const title of titles) removedToast(title);
};

/**
 * A save of the library diagram `projectId` could not reach it (#253): its
 * tab stays, its edits with it, and saving waits for the project to be
 * listed again — the way an external file's tab keeps what it cannot write.
 */
const unreachable = (projectId: string): void => {
  const tab = app().tabs.find((t) => sourceOf(t, app().activeTab, live()).projectId === projectId);
  if (tab) toastError(`Can't reach “${titleOf(tab)}” — not saved`);
};

/**
 * A save of the library diagram `id` found it gone from disk: its tab
 * closes as removed — unless it was kept before, when asked, for edits only
 * it holds: then it stays, and a toast says the save went nowhere.
 */
const gone = (id: string): void => {
  if (closing.has(id)) {
    // asked about by the close under way
    closing.set(id, true);
    return;
  }
  if (isKeptWhenGone(id)) {
    holdSaves(id);
    const tab = app().tabs.find((t) => sourceOf(t, app().activeTab, live()).projectId === id);
    if (tab) toastError(`“${titleOf(tab)}” is gone from disk — not saved`);
    return;
  }
  closeRemovedDiagrams(new Set([id])).catch(toastError);
};

// a save Rust refused: the file changed meanwhile — read it again — is gone,
// or cannot be reached
onSaveRefused((id, why) => {
  if (why === "gone") gone(id);
  else if (why === "unreachable") unreachable(id);
  else reloadDiagram(id, true).catch(toastError);
});

/**
 * The library diagrams whose saves waited for their project, now `listed`
 * again (#253): saved — what is on screen, and what a tab beside it holds
 * that its file does not.
 */
export const resumeReachable = (listed: ReadonlySet<string>): void => {
  for (const id of pausedProjects()) {
    if (!listed.has(id)) continue;
    resumeProject(id);
    const tab = readTab({ projectId: id });
    if (!tab) continue;
    if (tab.id === app().activeTab) {
      void writeProjectThroughChain(id);
    } else if (tab.doc && hasUnwrittenEdits(id, documentFile(tab.doc))) {
      void writeSnapshotThroughChain(id, documentFile(tab.doc));
    }
  }
};

/** the library diagrams read into tabs — what a look at the disk checks */
export const readLibraryIds = (): string[] => {
  const { tabs, activeTab } = app();
  return tabs.flatMap((t) => {
    const { projectId } = sourceOf(t, activeTab, live());
    return projectId !== null && (t.id === activeTab || t.doc) ? [projectId] : [];
  });
};

/** the external files open in tabs, read or not — what the watch covers */
export const externalPaths = (): string[] => {
  const { tabs, activeTab } = app();
  const paths = tabs
    .map((t) => sourceOf(t, activeTab, live()).filePath)
    .filter((p): p is string => p !== null);
  return [...new Set(paths)];
};

/**
 * The external file at `path` read again, in its tab (#253 D12) — the same
 * rule as a library diagram's. Nothing when it holds what the tab last wrote
 * or read; one that cannot be read now (half written, say) waits for the
 * next change.
 */
export const reloadExternalFile = async (path: string): Promise<void> => {
  if (!readTab({ filePath: path })) return;
  let read: Awaited<ReturnType<typeof readDiagramText>>;
  try {
    read = await readDiagramText(path);
  } catch {
    return;
  }
  const tab = readTab({ filePath: path });
  if (!tab) return;
  const active = tab.id === app().activeTab;
  const baseline = active ? externalBaseline() : tab.baseline;
  if (read.text === baseline) return;
  const fresh = prepare(read.doc, { filePath: path });
  const unsaved = active
    ? hasUnsavedExternalChanges()
    : tab.doc !== null && isUnsavedSnapshot(tab.doc, tab.baseline);
  const changed = takeFromDisk(tab.id, fresh);
  // the file and the tab agree now
  const bytes = fileBytes(fresh);
  if (active) setExternalBaseline(bytes);
  else patchTab(tab.id, { baseline: bytes });
  if (changed && unsaved) changedToast(fresh.title);
};

/**
 * The external file at `path` is gone (#253 D13): its tab closes, with a
 * toast — unless it holds edits no file has, which only it keeps: then it
 * stays, and Save writes them back.
 */
export const closeRemovedFile = (path: string): void => {
  const tab = app().tabs.find((t) => sourceOf(t, app().activeTab, live()).filePath === path);
  if (!tab) return;
  const title = titleOf(tab);
  if (unsavedPath(tab) === null) dropTab(tab.id);
  removedToast(title);
};

/** test seam: no tabs, Home on screen, nothing being read */
export const resetTabsForTests = (): void => {
  reading.clear();
  unreadableAfterRefusal.clear();
  wanted.clear();
  listedAfterWrites = 0;
  openingLibrary.clear();
  openWanted.clear();
  activationSeq = 0;
  showBlank();
  app().commitTabs({ tabs: [], activeTab: null, homeView: DASHBOARD });
};
