import { invoke } from "@tauri-apps/api/core";
import { nanoid } from "nanoid";

import { isDiagramDocShape, isMultiPage, MULTI_PAGE_ERROR } from "../../shared/lib/store/document";
import type { DiagramDoc } from "../../shared/lib/types";

/**
 * One diagram in the library. "Project" here is the file (#114's name for it);
 * the UI calls it a diagram since #161, and the folder it sits in is what the
 * UI calls a project — `FolderMeta` below.
 */
export interface ProjectMeta {
  id: string;
  title: string;
  /** last modification, ms since the Unix epoch */
  updatedAt: number;
  /**
   * Whether the app can open it (#229 D8): a one-canvas diagram. A file that
   * could not be read, or a document with pages (never shipped, D2), is
   * listed so it can be deleted — no picture, no preview, no Continue.
   */
  readable: boolean;
}

/**
 * The library lives in the app data folder and Rust owns it; the frontend
 * only ever speaks in ids. Ids are `[A-Za-z0-9_-]`, 10 chars — Rust rejects
 * anything else before touching the file system.
 */
export const newProjectId = (): string => nanoid(10);

/**
 * Where a project's frame sits on the Home canvas (#221 D7): its top-left in
 * board units, whole numbers, and whether its diagrams are folded into a
 * stack — left out, its size decides (D6). Kept in the project's folder.json.
 */
export interface BoardSpot {
  x: number;
  y: number;
  collapsed?: boolean;
}

/** how far from the origin a frame may be placed — Rust enforces it too */
export const BOARD_LIMIT = 1_000_000;

/**
 * A folder as the user sees it (#161, #229 D8): a project at the top of the
 * library, or a folder inside one, at any depth — its diagrams and folders.
 * Ids are unique across the library.
 */
export interface FolderMeta {
  id: string;
  name: string;
  /** the newest edit of anything in it, at any depth — or when it was made, if it is empty */
  updatedAt: number;
  /** in its order (#230) */
  diagrams: ProjectMeta[];
  /** the folders in it, in its order — `childrenOf` mixes the two */
  folders: FolderMeta[];
  /**
   * Its items, folders and diagrams mixed, in the user's order (#230 D2, D5)
   * — Rust works it out; absent from an older build or a test, when
   * `childrenOf` goes newest first
   */
  order?: ItemKey[];
  /** diagrams that could not be moved into a folder, listed under no folder on disk — no project actions */
  stray?: boolean;
  /** a project's frame on the Home canvas, once the canvas placed it (#221 D7) — never a folder's or a stray's */
  board?: BoardSpot;
  /**
   * A project whose folder cannot be found (#253 D9): listed in its place,
   * empty — its ids, order and frame wait for it to come back
   */
  missing?: boolean;
  /**
   * A project outside the default location — a folder added to the library
   * (#253 D15): it is removed from the library, never deleted
   */
  added?: boolean;
  /** a project's folder, whole — what "not found" names */
  path?: string;
  /** the same from `~` when it is under the home folder, for reading */
  shown?: string;
}

/**
 * An item of a folder as an order names it (#230 D1) — the tree's own keys:
 * `folder:<id>` (a project too) or `diagram:<id>`.
 */
export type ItemKey = `folder:${string}` | `diagram:${string}`;

export const itemKey = (kind: "folder" | "diagram", id: string): ItemKey => `${kind}:${id}`;

/** a key's kind and id; `null` for anything else */
export const parseItemKey = (key: string): { kind: "folder" | "diagram"; id: string } | null => {
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  return at > 0 && id.length > 0 && (kind === "folder" || kind === "diagram") ? { kind, id } : null;
};

/** names are trimmed and at most this long — Rust enforces it too */
export const MAX_FOLDER_NAME = 80;

/** folders nest at most this deep, a project being 1 — Rust's `MAX_DEPTH` (#229 D9) */
export const MAX_FOLDER_DEPTH = 10;

/** a listing as Rust sends it: `readable`, the board, the folders and a project's place raw, and absent from an older build */
type RawFolderMeta = Omit<
  FolderMeta,
  "diagrams" | "folders" | "board" | "order" | "missing" | "added" | "path" | "shown"
> & {
  diagrams: (Omit<ProjectMeta, "readable"> & { readable?: unknown; pageNames?: unknown })[];
  folders?: RawFolderMeta[];
  board?: unknown;
  order?: unknown;
  missing?: unknown;
  added?: unknown;
  path?: unknown;
  shown?: unknown;
};

/** an order as the app trusts it: a list of strings, or none (#230 D5) */
const cleanOrder = (raw: unknown): ItemKey[] | undefined =>
  Array.isArray(raw) && raw.every((k) => typeof k === "string") ? (raw as ItemKey[]) : undefined;

const inRange = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(Math.round(n)) <= BOARD_LIMIT;

/**
 * A place as the canvas can trust it (T6): whole numbers within the limit,
 * `collapsed` only when it is a bool — anything else is no place. Rust reads
 * the same way; this keeps a hand-edited file or an older build harmless.
 */
export const cleanBoardSpot = (raw: unknown): BoardSpot | undefined => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const { x, y, collapsed } = raw as Record<string, unknown>;
  if (!inRange(x) || !inRange(y)) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    ...(typeof collapsed === "boolean" ? { collapsed } : {}),
  };
};

/** a project's place on disk as the app trusts it: flags only when true, paths only when text (#253) */
const cleanPlace = ({ missing, added, path, shown }: RawFolderMeta) => ({
  ...(missing === true ? { missing } : {}),
  ...(added === true ? { added } : {}),
  ...(typeof path === "string" ? { path } : {}),
  ...(typeof shown === "string" ? { shown } : {}),
});

/** one listed folder as the app trusts it — its folders too; a board and a place only on a project (`top`) */
const cleanFolder = (raw: RawFolderMeta, top: boolean): FolderMeta => {
  const { board, folders, order, missing: _m, added: _a, path: _p, shown: _s, ...folder } = raw;
  const spot = top ? cleanBoardSpot(board) : undefined;
  const items = cleanOrder(order);
  return {
    ...folder,
    ...(top ? cleanPlace(raw) : {}),
    // an older build sends page names instead: whether it opens is the load's to say
    diagrams: folder.diagrams.map(({ readable, pageNames: _, ...diagram }) => ({
      ...diagram,
      readable: typeof readable === "boolean" ? readable : true,
    })),
    folders: (folders ?? []).map((sub) => cleanFolder(sub, false)),
    ...(items ? { order: items } : {}),
    ...(spot ? { board: spot } : {}),
  };
};

/**
 * Every project with its diagrams and folders, in the user's order (#230) —
 * the record brought in line with the disk on the way (#253): a folder made
 * in Finder shows, one removed there goes.
 */
export const listLibrary = async (): Promise<FolderMeta[]> => {
  const folders = await invoke<RawFolderMeta[]>("list_library");
  return folders.map((folder) => cleanFolder(folder, true));
};

/**
 * A new folder; resolves its id. A project, made on the Home canvas at its
 * `board` place there (#221 D15) — or, with `parent`, a folder inside that
 * one at any depth (#229 D11).
 */
export const createFolder = async (
  name: string,
  where: { board?: BoardSpot; parent?: string } = {},
): Promise<string> => {
  const id = newProjectId();
  await invoke("create_folder", {
    id,
    name,
    ...(where.board ? { board: where.board } : {}),
    ...(where.parent ? { parent: where.parent } : {}),
  });
  return id;
};

/** a project `setFolderBoards` could not place, and Rust's reason */
export interface BoardFailure {
  id: string;
  error: string;
}

/**
 * Puts frames where the Home canvas says (#221 D9) — one write for them all.
 * A project that cannot take its place fails alone: resolves those, each
 * with why (none — all placed). Rejects only when the call itself fails.
 */
export const setFolderBoards = async (
  boards: { id: string; board: BoardSpot }[],
): Promise<BoardFailure[]> => {
  const failed: unknown = await invoke("set_folder_boards", { boards });
  return Array.isArray(failed) ? (failed as BoardFailure[]) : [];
};

export const renameFolder = (id: string, name: string): Promise<void> =>
  invoke("rename_folder", { id, name });

/** moves the project or folder, with everything in it, to the Trash (#253 D14) — a folder added to the library is refused */
export const deleteFolder = (id: string): Promise<void> => invoke("delete_folder", { id });

/**
 * Moves a diagram into `folder`, at any depth, to `index` in its order — the
 * top when left out (#230 D4, D6); its id stays. In its own folder an index
 * changes its place.
 */
export const moveProject = (id: string, folder: string, index?: number): Promise<void> =>
  invoke("move_project", index === undefined ? { id, folder } : { id, folder, index });

/**
 * Moves a folder — never a project — with everything in it into `parent`,
 * to `index` in its order, the top when left out (#230 D6, D7).
 */
export const moveFolder = (id: string, parent: string, index?: number): Promise<void> =>
  invoke("move_folder", index === undefined ? { id, parent } : { id, parent, index });

/** `item` to `index` among the items of folder `parent` — the projects, for `null` (#230 D6) */
export const reorderItem = (parent: string | null, item: ItemKey, index: number): Promise<void> =>
  invoke("reorder_item", parent === null ? { item, index } : { parent, item, index });

/**
 * What a diagram's file was like when it was read or written (#253 D11): its
 * time, length and a hash of what it holds — Rust's `<mtime>-<length>-<hash>`.
 * A save brings back the one its tab last saw, and Rust writes over nothing
 * else.
 */
export type FileStamp = string;

/**
 * Whether two stamps are of the same contents — the length and the hash: a
 * file written again with the same bytes is no change of anyone's.
 */
export const sameContents = (a: FileStamp | undefined, b: FileStamp | undefined): boolean => {
  const tail = (s: FileStamp | undefined) => {
    const at = s?.indexOf("-") ?? -1;
    return at >= 0 ? s?.slice(at + 1) : undefined;
  };
  const x = tail(a);
  return x !== undefined && x === tail(b);
};

/** a library diagram as it was read: the document — its title its file's name — and its file's stamp */
export interface LoadedDiagram {
  doc: DiagramDoc;
  /** absent only from an answer that does not carry one (a test's) */
  stamp?: FileStamp;
}

/** Rust's answer to `load_project` as the app trusts it */
const readLoaded = (answer: unknown): LoadedDiagram => {
  const loaded =
    typeof answer === "string"
      ? { contents: answer }
      : (answer as { contents: string; name?: unknown; stamp?: unknown });
  const doc: unknown = JSON.parse(loaded.contents);
  if (isMultiPage(doc)) throw new Error(MULTI_PAGE_ERROR);
  if (!isDiagramDocShape(doc)) throw new Error("Not a valid diagram file");
  return {
    doc: typeof loaded.name === "string" ? { ...doc, title: loaded.name } : doc,
    ...(typeof loaded.stamp === "string" ? { stamp: loaded.stamp } : {}),
  };
};

/**
 * A library diagram, its title the name of its file (#253 D8) — a document
 * with pages (#229 D2) or of another shape throws. Rust answers
 * `{contents, name, stamp}`; a bare string (a test's answer) is the contents
 * alone.
 */
export const loadProjectFile = async (id: string): Promise<LoadedDiagram> =>
  readLoaded(await invoke<unknown>("load_project", { id }));

/** a library diagram's document alone — what a preview reads, leaving every tab's stamp as it was */
export const loadProject = async (id: string): Promise<DiagramDoc> =>
  readLoaded(await invoke<unknown>("load_project", { id })).doc;

/** the exact bytes a project file holds for a document */
export const serializeProject = (doc: DiagramDoc): string => JSON.stringify(doc, null, 2);

/**
 * What a save came to (#253 D8, D11): written — under `name`, its file's,
 * which may differ from the title (cleaned, or with " 2"), and `stamp` the
 * file as it is now — or not written, because the file is not what its tab
 * last saw (`changedOnDisk`), or is gone (`gone`).
 */
export type SaveOutcome =
  | { kind: "saved"; name?: string; stamp?: FileStamp }
  | { kind: "changedOnDisk" }
  | { kind: "gone" };

/** Rust's answer as the app trusts it — one that says nothing more (a test's) was written, nothing more known */
const cleanSaveOutcome = (raw: unknown): SaveOutcome => {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (answer.kind === "changedOnDisk") return { kind: "changedOnDisk" };
  if (answer.kind === "gone") return { kind: "gone" };
  return {
    kind: "saved",
    ...(typeof answer.name === "string" ? { name: answer.name } : {}),
    ...(typeof answer.stamp === "string" ? { stamp: answer.stamp } : {}),
  };
};

/**
 * Writes a diagram where it is, renamed after its title (#253 D8) — unless
 * `base`, the stamp its tab last saw, is not what is on disk now. A new one
 * goes into `folder` — or, when that is left out, Rust picks the most
 * recently edited project.
 */
export const saveProjectContents = async (
  id: string,
  contents: string,
  folder?: string,
  base?: FileStamp,
): Promise<SaveOutcome> =>
  cleanSaveOutcome(
    await invoke("save_project", {
      id,
      contents,
      ...(folder ? { folder } : {}),
      ...(base ? { base } : {}),
    }),
  );

export const saveProject = (id: string, doc: DiagramDoc, folder?: string): Promise<SaveOutcome> =>
  saveProjectContents(id, serializeProject(doc), folder);

/** moves a diagram to the Trash (#253 D14) */
export const deleteProject = (id: string): Promise<void> => invoke("delete_project", { id });

/** what Locate… came to (#253 D9): the folder picked took the project's place, nothing was picked, or it overlaps the library */
export type LocateAnswer = "located" | "cancelled" | "already";

/** Locate…: Rust shows the system's folder picker, so no path comes from here (#253 R14) */
export const locateProject = (id: string): Promise<LocateAnswer> =>
  invoke<LocateAnswer>("locate_project", { id });

/** Remove from Library: the project's record goes, its folder stays (#253 D9, D15) */
export const removeProject = (id: string): Promise<void> => invoke("remove_project", { id });

/** what a path is asked of (#238): a folder — a project or one inside one — or a diagram */
export type ItemKind = "folder" | "diagram";

/** where an item is on disk (#238): `path` whole, for copying; `shown` from `~`, for reading */
export interface ItemPath {
  path: string;
  shown: string;
}

/**
 * Where the library keeps an item — Rust finds it by id, the way every other
 * command does, so this side never rebuilds the disk's layout (#238 D4).
 */
export const libraryPath = (kind: ItemKind, id: string): Promise<ItemPath> =>
  invoke("library_path", { kind, id });

/** a folder opens in Finder; a diagram's file is shown selected there (#238 D3) — opened by Rust */
export const showInFinder = (kind: ItemKind, id: string): Promise<void> =>
  invoke("show_in_finder", { kind, id });

export const blankDoc = (): DiagramDoc => ({
  version: 1,
  title: "Untitled Diagram",
  nodes: [],
  edges: [],
});
