import {
  type FolderMeta,
  type ItemKey,
  itemKey,
  MAX_FOLDER_DEPTH,
  type ProjectMeta,
  parseItemKey,
} from "./libraryApi";

/**
 * The library's shape, worked out in one pure module (#229 D10): the tree,
 * Home, the board, the new-diagram target and the editor's path all ask it.
 * The listing is folders within folders (D8); ids are unique across it.
 */

/** a diagram as the listing has it, with the folder it is in and the path to it */
export interface FoundDiagram {
  diagram: ProjectMeta;
  /** the folder the diagram is listed in */
  folder: FolderMeta;
  /** the folders from the top down to `folder` — the editor's path (D3) */
  path: FolderMeta[];
}

/** a folder as the listing has it, with the path to it */
export interface FoundFolder {
  folder: FolderMeta;
  /** the folders from the top down to `folder` itself */
  path: FolderMeta[];
}

/** one item of a folder — a folder or a diagram */
export type FolderChild =
  | { kind: "folder"; folder: FolderMeta }
  | { kind: "diagram"; diagram: ProjectMeta };

/** an item's key in its folder's order (#230 D1) */
export const childKey = (c: FolderChild): ItemKey =>
  c.kind === "folder" ? itemKey("folder", c.folder.id) : itemKey("diagram", c.diagram.id);
const childTime = (c: FolderChild): number =>
  c.kind === "folder" ? c.folder.updatedAt : c.diagram.updatedAt;

/**
 * What a folder holds, in the one order the tree and Home show it (#230 D2,
 * D5): folders and diagrams mixed, in the order the user gave them — what
 * the order misses on top, most recently edited first, ties to the lower key
 * (Rust's rule; #229's whole order when there is none).
 */
export const childrenOf = (folder: FolderMeta): FolderChild[] => {
  const all = [
    ...folder.folders.map((f): FolderChild => ({ kind: "folder", folder: f })),
    ...folder.diagrams.map((d): FolderChild => ({ kind: "diagram", diagram: d })),
  ];
  const byKey = new Map(all.map((c) => [childKey(c) as string, c]));
  const listed: FolderChild[] = [];
  for (const key of folder.order ?? []) {
    const child = byKey.get(key);
    if (child) {
      listed.push(child);
      byKey.delete(key);
    }
  }
  const unlisted = [...byKey.values()].sort(
    (a, b) => childTime(b) - childTime(a) || (childKey(a) < childKey(b) ? -1 : 1),
  );
  return [...unlisted, ...listed];
};

/**
 * A project whose folder cannot be found (#253 D9, R7): listed in its place
 * — its order and its frame on the canvas are kept — but empty, until it is
 * found again.
 */
export const isMissing = (project: FolderMeta): boolean => project.missing === true;

/**
 * Whether project `project` takes items — the one rule for every place a
 * diagram or a folder is made in, moved to or dropped on: a folder on disk
 * that is there. Never a project not found (#253 R7).
 */
export const takesItems = (project: FolderMeta): boolean => !isMissing(project);

/** walks every folder, depth first in listing order, with the path to it */
const walk = function* (
  folders: readonly FolderMeta[],
  above: FolderMeta[] = [],
): Generator<FoundFolder> {
  for (const folder of folders) {
    const path = [...above, folder];
    yield { folder, path };
    yield* walk(folder.folders, path);
  }
};

/** the folder `id` at any depth; `null` when it is not listed */
export const findFolder = (folders: readonly FolderMeta[], id: string): FoundFolder | null => {
  for (const found of walk(folders)) if (found.folder.id === id) return found;
  return null;
};

/** the diagram `id`, where the listing has it, at any depth; `null` when it is not listed */
export const findDiagram = (folders: readonly FolderMeta[], id: string): FoundDiagram | null => {
  for (const { folder, path } of walk(folders)) {
    const diagram = folder.diagrams.find((d) => d.id === id);
    if (diagram) return { diagram, folder, path };
  }
  return null;
};

/** diagrams most recently edited first, ties to the lower id — the listing's order (D8) */
export const newestFirst = (a: ProjectMeta, b: ProjectMeta): number =>
  b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1);

/** every diagram in `folder` at any depth, most recently edited first — a board frame's cards (D18) */
export const diagramsUnder = (folder: FolderMeta): ProjectMeta[] =>
  [...walk([folder])].flatMap(({ folder: f }) => f.diagrams).sort(newestFirst);

/**
 * every diagram in the library, each with its folder and path — in listing
 * order; none of a project not found, which lists nothing until it is found
 * (#253 R7)
 */
export const allDiagrams = (folders: readonly FolderMeta[]): FoundDiagram[] =>
  [...walk(folders.filter((f) => !isMissing(f)))].flatMap(({ folder, path }) =>
    folder.diagrams.map((diagram) => ({ diagram, folder, path })),
  );

/** how many folders are under `folder`, at any depth — what deleting it takes with it (D12) */
export const foldersUnder = (folder: FolderMeta): number => [...walk(folder.folders)].length;

/** what a folder holds directly — its folders and diagrams (the tree's count, the "N items") */
export const itemCount = (folder: FolderMeta): number =>
  folder.folders.length + folder.diagrams.length;

/** every folder that takes items (`takesItems`), depth first, with its depth — a project is 1 */
export const folderList = (
  folders: readonly FolderMeta[],
): { folder: FolderMeta; depth: number }[] =>
  [...walk(folders.filter(takesItems))].map(({ folder, path }) => ({
    folder,
    depth: path.length,
  }));

/**
 * folder `id` as a place a diagram can be saved in or moved to — at any
 * depth, in a project that takes items (never a project not found); `null`
 * otherwise
 */
export const savableFolder = (
  folders: readonly FolderMeta[] | null,
  id: string | null,
): FolderMeta | null => {
  const found = id && folders ? findFolder(folders, id) : null;
  return found?.path[0] && takesItems(found.path[0]) ? found.folder : null;
};

/**
 * whether folder `id` can take a folder of its own — not at the deepest
 * level, where Rust refuses one (#229 D9): New folder is left off its menus
 * there, as Move to… is where there is nowhere to go (#229)
 */
export const canHoldFolders = (folders: readonly FolderMeta[], id: string): boolean => {
  const found = findFolder(folders, id);
  return found !== null && found.path.length < MAX_FOLDER_DEPTH;
};

/** whether a diagram has somewhere to move to: a real folder besides its own (Move to…) */
export const canMoveDiagrams = (folders: readonly FolderMeta[]): boolean =>
  folderList(folders).length > 1;

/** whether folder or diagram `id` is folder `ancestor` itself or anywhere under it */
export const isInside = (folders: readonly FolderMeta[], id: string, ancestor: string): boolean => {
  const found = findFolder(folders, ancestor);
  if (!found) return false;
  for (const { folder } of walk([found.folder])) {
    if (folder.id === id || folder.diagrams.some((d) => d.id === id)) return true;
  }
  return false;
};

/** the project (top folder) that folder or diagram `id` is in — itself, for a project */
export const projectOf = (folders: readonly FolderMeta[], id: string): FolderMeta | null =>
  findFolder(folders, id)?.path[0] ?? findDiagram(folders, id)?.path[0] ?? null;

/**
 * The diagrams the projects hold out of reach (#253) — the listing does not
 * show them, yet their files may be there: no tab of one is closed for it.
 */
export const heldDiagramIds = (folders: readonly FolderMeta[]): Set<string> =>
  new Set(folders.flatMap((f) => f.held ?? []));

/**
 * The most recently edited project that takes items, by what shows of it
 * (its listed `updatedAt`), ties to the one listed first — Rust's
 * `default_target`, so a new diagram's default goes where a save with no
 * folder would (#230 D5: the listing is in the user's order now)
 */
export const latestProject = (folders: readonly FolderMeta[] | null): FolderMeta | null =>
  (folders ?? [])
    .filter(takesItems)
    .reduce<FolderMeta | null>(
      (best, f) => (!best || f.updatedAt > best.updatedAt ? f : best),
      null,
    );

/** how many levels a folder takes, itself included (#230 D7) */
export const heightOf = (folder: FolderMeta): number =>
  1 + Math.max(0, ...folder.folders.map(heightOf));

/**
 * Whether `item` can go into folder `parent` — `null`, the projects' level
 * (#230 D7): a project only among the projects — never one not found, which
 * keeps its place (#253 R7); a folder or a diagram only into a folder that
 * takes items — a folder never into itself or under it, nor so deep that
 * something in it passes the limit. Rust refuses the same.
 */
export const canPlace = (
  folders: readonly FolderMeta[],
  item: ItemKey,
  parent: string | null,
): boolean => {
  const parsed = parseItemKey(item);
  if (!parsed) return false;
  if (parsed.kind === "diagram") {
    return (
      parent !== null &&
      findDiagram(folders, parsed.id) !== null &&
      !!savableFolder(folders, parent)
    );
  }
  const found = findFolder(folders, parsed.id);
  if (!found?.path[0] || !takesItems(found.path[0])) return false;
  const isProject = found.path.length === 1;
  if (parent === null || isProject) return parent === null && isProject;
  const target = savableFolder(folders, parent) ? findFolder(folders, parent) : null;
  if (!target || isInside(folders, parent, parsed.id)) return false;
  return target.path.length + heightOf(found.folder) <= MAX_FOLDER_DEPTH;
};

/** whether folder `id` has somewhere to move to besides where it is (a folder's Move to…, #230 D12) */
export const canMoveFolder = (folders: readonly FolderMeta[], id: string): boolean => {
  const parent = findFolder(folders, id)?.path.at(-2)?.id;
  return folderList(folders).some(
    ({ folder }) => folder.id !== parent && canPlace(folders, itemKey("folder", id), folder.id),
  );
};

/** the folders from the top down to item `{kind, id}` — a diagram's folder, or the folder itself */
const itemPath = (
  folders: readonly FolderMeta[],
  { kind, id }: { kind: "folder" | "diagram"; id: string },
): FolderMeta[] | undefined =>
  kind === "diagram" ? findDiagram(folders, id)?.path : findFolder(folders, id)?.path;

/** item `{kind, id}` as a folder's child, where the listing has it */
const childFor = (
  folders: readonly FolderMeta[],
  { kind, id }: { kind: "folder" | "diagram"; id: string },
): FolderChild | null => {
  if (kind === "diagram") {
    const found = findDiagram(folders, id);
    return found ? { kind, diagram: found.diagram } : null;
  }
  const found = findFolder(folders, id);
  return found ? { kind, folder: found.folder } : null;
};

/**
 * Where `item` is among its siblings — the folder it is in (`null`: the
 * projects), their keys in order, and its place (#230 D10). `null` for what
 * is not listed.
 */
export const siblingsOf = (
  folders: readonly FolderMeta[],
  item: ItemKey,
): { parent: string | null; keys: ItemKey[]; index: number } | null => {
  const parsed = parseItemKey(item);
  const found = parsed && itemPath(folders, parsed);
  if (!parsed || !found) return null;
  // a diagram's path ends at the folder it is in, a folder's at itself
  const parent = (parsed.kind === "diagram" ? found : found.slice(0, -1)).at(-1) ?? null;
  const keys = parent
    ? childrenOf(parent).map(childKey)
    : folders.map((f) => itemKey("folder", f.id));
  return { parent: parent?.id ?? null, keys, index: keys.indexOf(item) };
};

/** `folders` with each folder `edit` returns in place of it, at any depth — the rest the same objects */
const mapFolders = (
  folders: readonly FolderMeta[],
  edit: (f: FolderMeta) => FolderMeta,
): FolderMeta[] =>
  folders.map((f) => {
    const inner = mapFolders(f.folders, edit);
    const same = inner.every((child, i) => child === f.folders[i]);
    return edit(same ? f : { ...f, folders: inner });
  });

/** `folder` with its items in `order` — its arrays and its `order` */
const arranged = (folder: FolderMeta, order: ItemKey[], extra?: FolderChild): FolderMeta => {
  const byKey = new Map(
    [...childrenOf(folder), ...(extra ? [extra] : [])].map((c) => [childKey(c) as string, c]),
  );
  const items = order.flatMap((k) => byKey.get(k) ?? []);
  return {
    ...folder,
    order,
    folders: items.flatMap((c) => (c.kind === "folder" ? [c.folder] : [])),
    diagrams: items.flatMap((c) => (c.kind === "diagram" ? [c.diagram] : [])),
  };
};

/** `order` with `key` at `index` — out of where it was first; past the end is the end */
const placeKey = (order: ItemKey[], key: ItemKey, index: number): ItemKey[] => {
  const rest = order.filter((k) => k !== key);
  const at = Math.min(Math.max(index, 0), rest.length);
  return [...rest.slice(0, at), key, ...rest.slice(at)];
};

/** where an item goes: into folder `parent` (`null`: among the projects), at `index` there (#230 D13) */
export interface Placement {
  parent: string | null;
  index: number;
}

/**
 * The listing with `item` at `index` in folder `parent` (`null`: among the
 * projects) — what the screen shows while the write is on its way (#230 D13),
 * the way Rust will write it. Unchanged for what is not listed.
 */
export const placedInList = (
  folders: FolderMeta[],
  item: ItemKey,
  { parent, index }: Placement,
): FolderMeta[] => {
  const parsed = parseItemKey(item);
  if (!parsed) return folders;
  if (parent === null) {
    const moving = folders.find((f) => f.id === parsed.id);
    if (parsed.kind !== "folder" || !moving) return folders;
    const order = placeKey(
      folders.map((f) => itemKey("folder", f.id)),
      item,
      index,
    );
    const byKey = new Map(folders.map((f) => [itemKey("folder", f.id) as string, f]));
    return order.flatMap((k) => byKey.get(k) ?? []);
  }
  const child = childFor(folders, parsed);
  if (!child || !findFolder(folders, parent)) return folders;
  // out of where it is — the target keeps it when it is the same folder
  const without = mapFolders(folders, (f) => {
    if (f.id === parent) return f;
    const order = childrenOf(f).map(childKey);
    return order.includes(item)
      ? arranged(
          f,
          order.filter((k) => k !== item),
        )
      : f;
  });
  return mapFolders(without, (f) =>
    f.id === parent ? arranged(f, placeKey(childrenOf(f).map(childKey), item, index), child) : f,
  );
};
