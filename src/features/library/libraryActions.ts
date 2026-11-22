import { ask } from "@tauri-apps/plugin-dialog";

import { writeClipboardText } from "../../shared/lib/systemClipboard";
import { toastError, useToastStore } from "../../shared/lib/toastStore";
import { showProjectRow } from "../sidebar/treeStore";
import { useAppStore } from "./appStore";
import { trashName } from "./fileManager";
import { DASHBOARD } from "./homeView";
import {
  type BoardSpot,
  countOtherFiles,
  createFolder,
  deleteFolder,
  deleteProject,
  type FolderMeta,
  type ItemKey,
  type ItemKind,
  itemKey,
  libraryPath,
  locateProject,
  moveFolder,
  moveProject,
  type ProjectMeta,
  parseItemKey,
  pickDefaultLocation,
  pickLibraryFolder,
  removeProject,
  renameFolder,
  reorderItem,
  showInFinder,
} from "./libraryApi";
import {
  refreshLibraryQuietly,
  resetPlacementsForTests as resetStorePlacements,
  showPlacement,
  useLibraryStore,
} from "./libraryStore";
import {
  canPlace,
  diagramsUnder,
  findDiagram,
  findFolder,
  foldersUnder,
  isInside,
  type Placement,
  siblingsOf,
} from "./libraryTree";
import { screenStamp, stillOnScreen } from "./screenStamp";
import { closeDiagramTabs, confirmDiscardDiagramTabs } from "./tabActions";
import { flushAutosave } from "./useAutosave";

const pushToast = (text: string) => useToastStore.getState().pushToast(text);

/**
 * What Home and the sidebar do to the library (#161, #217). Each one reports a
 * failure as a toast and lists the library again afterwards — Rust's answer,
 * not a guess of it, is what the screen shows.
 *
 * Diagrams can be open in tabs (#218 D20): deleting one, or its project,
 * closes their tabs first and waits for every write, so autosave cannot put
 * a file back; moving one waits for its writes too.
 */

const refresh = () => useLibraryStore.getState().refresh();

const guarded = async <T>(task: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await task();
  } catch (error) {
    toastError(error);
    return undefined;
  }
};

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** whether one of the system's folder pickers Rust opens is up now */
let picking = false;

/**
 * Opens a folder picker through `pick` — unless one is up already (a second
 * press of Add folder…, Change… or Locate… before the first one closed):
 * then none, and nothing to say (`undefined`). One at a time, so two answers
 * never land one after another.
 */
const onePicker = async <T>(pick: () => Promise<T>): Promise<T | undefined> => {
  if (picking) return undefined;
  picking = true;
  try {
    return await pick();
  } finally {
    picking = false;
  }
};

/**
 * A new, empty folder; resolves to its id so the caller can start renaming
 * it. A project ("New project") — made on the Home canvas, it takes its
 * `board` place in the same write (#221 D15) — or, with `parent`, a folder
 * inside that one ("New folder", #229 D11). Too deep is Rust's error, a toast.
 */
export const newFolder = (
  where: { board?: BoardSpot; parent?: string } = {},
): Promise<string | undefined> =>
  guarded(async () => {
    const id = await createFolder(where.parent ? "New folder" : "New project", where);
    await refresh();
    return id;
  });

/** a blank name keeps the old one — Rust refuses it anyway */
export const renameFolderTo = (folder: FolderMeta, name: string): Promise<void> =>
  guarded(async () => {
    const next = name.trim();
    if (!next || next === folder.name) return;
    await renameFolder(folder.id, next);
    await refresh();
  }).then(() => undefined);

const tabIds = () => new Set(useAppStore.getState().tabs.map((t) => t.id));

/** what every delete's question ends with: it goes to the Trash, never for good (#253 D14) */
const toTrash = (): string => `It will be moved to ${trashName()}.`;

/**
 * Asks, and resolves whether to go ahead. The dialog is async and the bridge
 * is not: an agent's ops arriving while it was up may have made a diagram and
 * opened it — in this very project, maybe. Deleting then would take that work
 * with it (#161), so a tab opened while the dialog was up means no
 * (#218 D20, which replaced #217's comparison of the diagram on screen).
 */
const confirmDelete = async (name: string, message: string, title: string): Promise<boolean> => {
  const before = tabIds();
  const confirmed = await ask(message, {
    title,
    kind: "warning",
    okLabel: "Delete",
    cancelLabel: "Cancel",
  });
  if (!confirmed) return false;
  if ([...tabIds()].some((id) => !before.has(id))) {
    pushToast(`“${name}” was not deleted — a diagram was opened meanwhile.`);
    return false;
  }
  return true;
};

/**
 * What a folder's delete takes along, for its question (#229 D12, #253):
 * its folders and diagrams, and the other files Rust counted in it — every
 * file goes to the Trash with it. Not counted (`null`), it may hold anything.
 */
const weightOf = (folder: FolderMeta, others: number | null): string => {
  const diagrams = diagramsUnder(folder).length;
  const subfolders = foldersUnder(folder);
  const shown = [
    ...(subfolders > 0 ? [plural(subfolders, "folder")] : []),
    ...(diagrams > 0 ? [plural(diagrams, "diagram")] : []),
  ].join(", ");
  if (others === null) return " and everything in it";
  const rest = others > 0 ? plural(others, "other file") : "";
  const all = shown && rest ? `${shown} and ${rest}` : shown || rest;
  return all ? ` and everything in it (${all})` : "";
};

/**
 * Asks — with the weight of what goes: every folder and diagram under it
 * (#229 D12), and the other files in it (#253) — and resolves whether it
 * was deleted. A project or a folder at any depth.
 */
export const deleteFolderAsking = (folder: FolderMeta): Promise<boolean> =>
  guarded(async () => {
    const listed = useLibraryStore.getState().folders ?? [folder];
    const path = findFolder(listed, folder.id)?.path ?? [folder];
    const kind = path.length > 1 ? "folder" : "project";
    const parent = path.at(-2) ?? null;
    const diagrams = diagramsUnder(folder);
    const others = await countOtherFiles(folder.id).catch(() => null);
    const go = await confirmDelete(
      folder.name,
      `Delete the ${kind} “${folder.name}”${weightOf(folder, others)}? ${toTrash()}`,
      kind === "folder" ? "Delete folder" : "Delete project",
    );
    if (!go) return false;
    // the diagrams it holds out of reach go too: their edits asked about first
    const ids = new Set([...diagrams.map((d) => d.id), ...(folder.held ?? [])]);
    if (!(await confirmDiscardDiagramTabs(ids))) return false;
    // every diagram under it closes its tab, and every write lands, before
    // the folder goes — autosave must not write one of them back into a
    // folder that is gone. Every other tab stays as it is, the active one too
    // (#217)
    closeDiagramTabs(ids);
    await flushAutosave();
    await deleteFolder(folder.id);
    leaveGone(listed, folder.id, parent);
    await refresh();
    return true;
  }).then((deleted) => deleted === true);

/**
 * Home's view of anything gone from the library — folder `id`, or one inside
 * it — would be empty and lost: Home goes to `parent`, the folder it was in,
 * or the dashboard for a project, whether it is on show or only where the
 * Home tab goes back to (#220 D1, #229 D5)
 */
const leaveGone = (listed: FolderMeta[], id: string, parent: FolderMeta | null): void => {
  const app = useAppStore.getState();
  const { homeView } = app;
  if (homeView.kind === "folder" && isInside(listed, homeView.folder, id)) {
    app.setHomeView(parent ? { kind: "folder", folder: parent.id } : DASHBOARD);
  }
};

/**
 * Locate… (#253 D9): Rust shows the system's folder picker, and the folder
 * picked takes the project's place — its ids, order and frame come back —
 * so the library is listed again. A folder already in the library, or inside
 * one, is not taken: the toast says so. Nothing picked is nothing. Resolves
 * whether it was located.
 */
export const locateProjectAsking = (folder: FolderMeta): Promise<boolean> =>
  guarded(async () => {
    const answer = await onePicker(() => locateProject(folder.id));
    if (answer === "already") pushToast("Already in the library");
    if (answer !== "located") return false;
    await refresh();
    return true;
  }).then((located) => located === true);

/**
 * Remove from Library (#253 D9, D15): the project's record goes and its
 * folder stays where it is, so no file is lost. As for a delete, its
 * diagrams' tabs close — the ones it holds out of reach too — and every
 * write lands first, and Home's view of it goes. A tab holding edits its
 * project's absence kept from the file asks first, as an external file's
 * would: Cancel keeps everything. Resolves whether it was removed.
 */
export const removeFromLibrary = (folder: FolderMeta): Promise<boolean> =>
  guarded(async () => {
    const listed = useLibraryStore.getState().folders ?? [folder];
    const ids = new Set([...diagramsUnder(folder).map((d) => d.id), ...(folder.held ?? [])]);
    if (!(await confirmDiscardDiagramTabs(ids))) return false;
    closeDiagramTabs(ids);
    await flushAutosave();
    await removeProject(folder.id);
    leaveGone(listed, folder.id, null);
    await refresh();
    return true;
  }).then((removed) => removed === true);

/**
 * Add folder… (#256 R1): Rust shows the system's folder picker and the
 * folder picked joins the library as one project, on top, saved where it
 * is. Once listed, its row is picked and scrolled to — while the screen is
 * still the one it was asked from: the picker waits, and where the user went
 * meanwhile is left alone (#218 D15). A folder in the library already, or one
 * that cannot be a project (too broad, the app's data folder), is not added:
 * the toast says which. Nothing picked is nothing.
 * Resolves the new project's id.
 */
export const addFolderToLibrary = (): Promise<string | undefined> =>
  guarded(async () => {
    const asked = screenStamp();
    const answer = await onePicker(pickLibraryFolder);
    if (answer?.kind === "already") pushToast("Already in the library");
    // too broad, or the app's own data folder: one word for both
    if (answer?.kind === "invalid") pushToast("Choose another folder");
    if (answer?.kind !== "added") return undefined;
    await refresh();
    if (stillOnScreen(asked)) showProjectRow(answer.id);
    return answer.id;
  });

/**
 * Change… (#256 R2): Rust shows the folder picker and the folder picked is
 * where new projects go from now — every project stays, and the folders in
 * it join the library — so it is listed again. A folder that is a project or
 * inside one, or too broad, is not taken: the toast says so. Resolves
 * whether it changed — Rust's word, whatever the listing after it comes to.
 */
export const changeDefaultLocation = (): Promise<boolean> =>
  guarded(async () => {
    const answer = await onePicker(pickDefaultLocation);
    if (answer === "invalid") pushToast("Choose another folder for new projects");
    if (answer !== "changed") return false;
    // changed: a listing that fails now says why, and takes nothing back
    await refresh().catch(toastError);
    return true;
  }).then((changed) => changed === true);

/** the writes that place items, one after another (#230 D13) */
let placing: Promise<unknown> = Promise.resolve();

/**
 * Puts `item` at `to` — the one way in for a drag in the tree, ⌥↑/⌥↓ and a
 * folder's Move to… (#230 D13). Among its siblings it is `reorder_item`;
 * into another folder `move_project` or `move_folder`, after every autosave
 * has landed (the files move; tabs stay, ids do not change), and a toast says
 * where. The screen shows it at once; the writes go one after another; the
 * library is listed again after each. Resolves whether it was placed —
 * nowhere it may go (#230 D7) or where it is already writes nothing.
 */
export const placeItem = (item: ItemKey, to: Placement): Promise<boolean> => {
  const folders = useLibraryStore.getState().folders;
  const parsed = parseItemKey(item);
  if (!folders || !parsed || !canPlace(folders, item, to.parent)) return Promise.resolve(false);
  const now = siblingsOf(folders, item);
  const same = now !== null && now.parent === to.parent;
  if (same && Math.min(Math.max(to.index, 0), now.keys.length - 1) === now.index) {
    return Promise.resolve(false);
  }
  const name =
    parsed.kind === "diagram"
      ? findDiagram(folders, parsed.id)?.diagram.title
      : findFolder(folders, parsed.id)?.folder.name;
  const where = to.parent ? findFolder(folders, to.parent)?.folder.name : undefined;
  const settle = showPlacement(item, to);
  const write = async (): Promise<boolean> => {
    let written = false;
    try {
      if (same) {
        await reorderItem(to.parent, item, to.index);
      } else if (to.parent) {
        // an open diagram's edit waiting, or one on its way to disk, is
        // written where it is — never racing the rename (#218 D20)
        await flushAutosave();
        if (parsed.kind === "diagram") await moveProject(parsed.id, to.parent, to.index);
        else await moveFolder(parsed.id, to.parent, to.index);
        pushToast(where ? `Moved “${name}” to ${where}` : `Moved “${name}”`);
      }
      written = true;
      return true;
    } catch (error) {
      toastError(error);
      return false;
    } finally {
      // written: the place is held until the listing read after the write has
      // landed — a listing asked before it would otherwise show the old order
      // again (#230). Failed: let it go first, so the listing shows
      // the truth.
      if (!written) settle();
      await refresh().catch(() => undefined);
      if (written) settle();
    }
  };
  const run = placing.then(write);
  placing = run.catch(() => undefined);
  return run;
};

/** a folder's Move to…: to the top of folder `target` (#230 D12) */
export const moveFolderTo = (folder: FolderMeta, target: string): Promise<boolean> =>
  placeItem(itemKey("folder", folder.id), { parent: target, index: 0 });

/** test seam: no placing write on its way, nothing shown early */
export const resetPlacementsForTests = (): void => {
  placing = Promise.resolve();
  resetStorePlacements();
};

/**
 * Moves a diagram to another project and says so (#221 D13) — the canvas's
 * drop and every Move to… menu alike. Resolves whether it moved; a failure
 * is a toast and a fresh listing, so a screen that showed the move early
 * shows the truth again.
 */
export const moveDiagram = async (diagram: ProjectMeta, folder: string): Promise<boolean> => {
  const moved = await guarded(async () => {
    // an open diagram may have an edit waiting, or one just left on its way
    // to disk: written where it is, never racing the rename that moves the
    // file (D11). Its tab stays — the id does not change (#218 D20)
    await flushAutosave();
    await moveProject(diagram.id, folder);
    const listed = useLibraryStore.getState().folders;
    const name = listed ? findFolder(listed, folder)?.folder.name : undefined;
    pushToast(name ? `Moved “${diagram.title}” to ${name}` : `Moved “${diagram.title}”`);
    await refresh();
    return true;
  });
  if (moved) return true;
  refreshLibraryQuietly();
  return false;
};

/**
 * Resolves whether it was deleted. Home's view stays where it is: no view
 * shows a diagram (#231 D1), and a card selected on it is gone from the
 * listing, so nothing is selected any more (D7).
 */
export const deleteDiagramAsking = (diagram: ProjectMeta): Promise<boolean> =>
  guarded(async () => {
    const go = await confirmDelete(
      diagram.title,
      `Delete “${diagram.title}”? ${toTrash()}`,
      "Delete diagram",
    );
    if (!go) return false;
    // an open diagram's tab closes as × would, then every write lands (D20)
    closeDiagramTabs(new Set([diagram.id]));
    await flushAutosave();
    await deleteProject(diagram.id);
    await refresh();
    return true;
  }).then((deleted) => deleted === true);

/** Show in Finder (#238 R4): nothing to say when it opens; why not, when it does not */
export const showItemInFinder = async (kind: ItemKind, id: string): Promise<void> => {
  try {
    await showInFinder(kind, id);
  } catch (error) {
    toastError(error);
  }
};

/**
 * Copy Path (#238 R4): the item's whole path — not the `~` one, which means
 * nothing outside a shell — on the clipboard, and the bottom toast says so.
 */
export const copyItemPath = async (kind: ItemKind, id: string): Promise<void> => {
  let path: string;
  try {
    ({ path } = await libraryPath(kind, id));
  } catch (error) {
    toastError(error);
    return;
  }
  if (await writeClipboardText(path)) useToastStore.getState().pushToast("Path copied");
  else toastError("Couldn't copy the path");
};
