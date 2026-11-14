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

/** a listing as Rust sends it: `readable`, the board and the folders raw, and absent from an older build */
type RawFolderMeta = Omit<FolderMeta, "diagrams" | "folders" | "board" | "order"> & {
  diagrams: (Omit<ProjectMeta, "readable"> & { readable?: unknown; pageNames?: unknown })[];
  folders?: RawFolderMeta[];
  board?: unknown;
  order?: unknown;
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

/** one listed folder as the app trusts it — its folders too; a board only on a project (`top`) */
const cleanFolder = (
  { board, folders, order, ...folder }: RawFolderMeta,
  top: boolean,
): FolderMeta => {
  const spot = top ? cleanBoardSpot(board) : undefined;
  const items = cleanOrder(order);
  return {
    ...folder,
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
 * the stray listing last. Diagrams saved before projects existed move into
 * "My Diagrams" on the way.
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

/** deletes the project and every diagram in it */
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

/** a library diagram — a document with pages (#229 D2) or of another shape throws */
export const loadProject = async (id: string): Promise<DiagramDoc> => {
  const contents = await invoke<string>("load_project", { id });
  const doc: unknown = JSON.parse(contents);
  if (isMultiPage(doc)) throw new Error(MULTI_PAGE_ERROR);
  if (!isDiagramDocShape(doc)) throw new Error("Not a valid diagram file");
  return doc;
};

/** the exact bytes a project file holds for a document */
export const serializeProject = (doc: DiagramDoc): string => JSON.stringify(doc, null, 2);

/**
 * Writes a diagram where it is. A new one goes into `folder` — or, when that
 * is left out, Rust picks the most recently edited project.
 */
export const saveProjectContents = (id: string, contents: string, folder?: string): Promise<void> =>
  invoke("save_project", folder ? { id, contents, folder } : { id, contents });

export const saveProject = (id: string, doc: DiagramDoc, folder?: string): Promise<void> =>
  saveProjectContents(id, serializeProject(doc), folder);

export const deleteProject = (id: string): Promise<void> => invoke("delete_project", { id });

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
