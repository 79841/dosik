import type { AppView } from "../library/appStore";
import { type HomeView, resolveHomeView } from "../library/homeView";
import type { FolderMeta, ProjectMeta } from "../library/libraryApi";
import { childrenOf, findDiagram, findFolder, itemCount } from "../library/libraryTree";

/**
 * The sidebar's tree as data (#217 R3, #229 D6): project → folders and
 * diagrams → folders and diagrams …, which row is selected, which rows show,
 * and where the keyboard goes. A diagram is one canvas, so its row is a leaf.
 * React only draws it.
 */

/** a row's identity, stable across listings — `folder:<id>` (a project too), `diagram:<id>` */
export type TreeKey = string;

export const FOLDER_PREFIX = "folder:";
/** every folder's key, a project's included — ids are unique across the library */
export const folderKey = (id: string): TreeKey => `${FOLDER_PREFIX}${id}`;
export const diagramKey = (id: string): TreeKey => `diagram:${id}`;
/** the Views nav's Home row — selected while Home shows the dashboard (D6) */
export const HOME_KEY: TreeKey = "nav:home";
/** the Views nav's Recent row — selected while Home shows Recent (#220 D3) */
export const RECENT_KEY: TreeKey = "nav:recent";

/**
 * The row a Home view selects (#220 D3) — a nav row or a folder; a diagram's
 * row is the editor's alone (#231 D1)
 */
export const homeSelectionKey = (view: HomeView): TreeKey => {
  switch (view.kind) {
    case "dashboard":
      return HOME_KEY;
    case "recent":
      return RECENT_KEY;
    case "folder":
      return folderKey(view.folder);
  }
};

export interface DiagramNode {
  kind: "diagram";
  key: TreeKey;
  diagram: ProjectMeta;
  /** the folder it is listed in */
  folder: FolderMeta;
  /** an open diagram's is its tab's, live; the others the listing's (D8) */
  title: string;
}

/** a project (the top folder) or a folder inside one */
export interface FolderNode {
  kind: "project" | "folder";
  key: TreeKey;
  folder: FolderMeta;
  /** its folders and diagrams, in `childrenOf` order (#229 D8) */
  children: TreeNode[];
  /** what it holds directly — the row's count, hidden at 0 */
  count: number;
  /** an empty folder has nothing to unfold (D7) */
  expandable: boolean;
}

export type TreeNode = FolderNode | DiagramNode;

/**
 * An open diagram as its tab has it — the one on screen from the store, the
 * others from their snapshots — so a new title shows at once (D8, #218 D19).
 */
export interface LiveDiagram {
  id: string;
  title: string;
}

const folderNode = (
  folder: FolderMeta,
  kind: FolderNode["kind"],
  opens: readonly LiveDiagram[],
): FolderNode => {
  const children = childrenOf(folder).map((child): TreeNode => {
    if (child.kind === "folder") return folderNode(child.folder, "folder", opens);
    const { diagram } = child;
    const open = opens.find((o) => o.id === diagram.id) ?? null;
    return {
      kind: "diagram",
      key: diagramKey(diagram.id),
      diagram,
      folder,
      title: open ? open.title : diagram.title,
    };
  });
  return {
    kind,
    key: folderKey(folder.id),
    folder,
    children,
    count: itemCount(folder),
    expandable: children.length > 0,
  };
};

/** the listing, with the open diagrams' rows taken from their tabs */
export const buildTree = (folders: FolderMeta[], opens: readonly LiveDiagram[]): FolderNode[] =>
  folders.map((folder) => folderNode(folder, "project", opens));

/**
 * The one selected row (D6, #220 D3): on Home, the row of what Home shows —
 * resolved against the listing, so a view of something gone selects the Home
 * row; in the editor, its diagram. An external file selects nothing.
 */
export const selectedKey = ({
  view,
  homeView,
  folders,
  projectId,
}: {
  view: AppView;
  homeView: HomeView;
  folders: FolderMeta[] | null;
  projectId: string | null;
}): TreeKey | null => {
  if (view === "home") return homeSelectionKey(resolveHomeView(homeView, folders));
  return projectId ? diagramKey(projectId) : null;
};

/**
 * What a Home view unfolds (#220 D3, #229 D6, #231 D1): a folder's
 * ancestors, so its row shows, and the folder itself, so what Home shows
 * shows under it too (canvas `Hybrid-Folder-Cards`) — but an empty folder
 * has nothing to unfold (D7). Nothing while the listing lacks it.
 */
export const homeOpenKeys = (view: HomeView, folders: FolderMeta[] | null): TreeKey[] => {
  const found = folders && view.kind === "folder" ? findFolder(folders, view.folder) : null;
  if (!found) return [];
  const chain = itemCount(found.folder) > 0 ? found.path : found.path.slice(0, -1);
  return chain.map((f) => folderKey(f.id));
};

/** what has to unfold for the open diagram's row to show (D7): every folder it is in */
export const openKeys = (folders: FolderMeta[] | null, projectId: string | null): TreeKey[] => {
  if (!projectId || !folders) return [];
  return findDiagram(folders, projectId)?.path.map((f) => folderKey(f.id)) ?? [];
};

export interface TreeRow {
  key: TreeKey;
  node: TreeNode;
  /** a project is 1; a folder at depth k is k, a diagram in it k + 1 */
  level: number;
  parent: TreeKey | null;
  expandable: boolean;
  /** unfolded — never true for a row with nothing under it */
  expanded: boolean;
}

/** the rows on show, top to bottom: a row's children only while it is unfolded */
export const visibleRows = (tree: FolderNode[], expanded: ReadonlySet<TreeKey>): TreeRow[] => {
  const rows: TreeRow[] = [];
  const add = (node: TreeNode, level: number, parent: TreeKey | null) => {
    const children = node.kind === "diagram" ? [] : node.children;
    const expandable = children.length > 0;
    const open = expandable && expanded.has(node.key);
    rows.push({ key: node.key, node, level, parent, expandable, expanded: open });
    if (open) for (const child of children) add(child, level + 1, node.key);
  };
  for (const project of tree) add(project, 1, null);
  return rows;
};

export type TreeKeyAction = { focus?: TreeKey; expand?: TreeKey; collapse?: TreeKey };

/**
 * What a navigation key does in the tree (WAI-ARIA tree, D29). `null` is a
 * key the tree leaves alone; `{}` is one it handles by doing nothing (→ on a
 * leaf), which still must not reach the canvas.
 */
export const treeKeyAction = (
  rows: TreeRow[],
  focus: TreeKey,
  key: string,
): TreeKeyAction | null => {
  const at = rows.findIndex((r) => r.key === focus);
  const row = rows[at];
  const first = rows[0]?.key;
  const last = rows[rows.length - 1]?.key;
  switch (key) {
    case "ArrowDown":
      return { focus: at < 0 ? first : (rows[at + 1]?.key ?? focus) };
    case "ArrowUp":
      return { focus: at < 0 ? first : (rows[at - 1]?.key ?? focus) };
    case "Home":
      return { focus: first };
    case "End":
      return { focus: last };
    case "ArrowRight":
      if (!row?.expandable) return {};
      if (!row.expanded) return { expand: row.key };
      return { focus: rows[at + 1]?.key };
    case "ArrowLeft":
      if (!row) return {};
      if (row.expanded) return { collapse: row.key };
      return row.parent ? { focus: row.parent } : {};
    default:
      return null;
  }
};
