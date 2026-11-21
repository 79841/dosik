import { ChevronDown, ChevronRight, Ellipsis, FolderPlus, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import { DROP_RING, DROP_TARGET, FOCUS_RING, FOCUS_TREE_ROW } from "../../shared/lib/palette";
import { usePointerDrag } from "../../shared/lib/pointerDrag";
import { useDiagramStore } from "../../shared/lib/store";
import { toastError } from "../../shared/lib/toastStore";
import { isMacContextClick } from "../../shared/lib/windowChrome";
import { useAppStore } from "../library/appStore";
import { type FolderMeta, type ItemKey, parseItemKey } from "../library/libraryApi";
import {
  moveDiagram,
  moveFolderTo,
  newFolder,
  placeItem,
  plural,
  renameFolderTo,
} from "../library/libraryActions";
import { diagramMenuItems, folderMenuItems } from "../library/libraryMenus";
import { indentClass, NameInput, SKELETON_DELAY_MS } from "../library/libraryParts";
import { refreshLibraryQuietly, useLibraryStore } from "../library/libraryStore";
import {
  canHoldFolders,
  canMoveDiagrams,
  canMoveFolder,
  findDiagram,
  findFolder,
  siblingsOf,
} from "../library/libraryTree";
import { diagramMovePicker, folderMovePicker } from "../library/MovePicker";
import { openFromLibrary, viewInHome } from "../library/navigation";
import { relativeTime } from "../library/relativeTime";
import { screenStamp, stillOnScreen } from "../library/screenStamp";
import {
  buildTree,
  diagramKey,
  folderKey,
  type LiveDiagram,
  openKeys,
  selectedKey,
  type TreeKey,
  treeKeyAction,
  type TreeNode,
  visibleRows,
} from "./treeModel";
import { DiagramGlyph, FolderGlyph } from "../../shared/ui/KindGlyph";
import { besidePointer, Menu, type MenuItem } from "../../shared/ui/Menu";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";
import { type DropTarget, dropAt, keyboardStep, placementNotice, type RowBox } from "./treeDrop";
import { TreeDragLayer } from "./TreeDragLayer";
import { unfoldedFolders, useTreeStore } from "./treeStore";

type Point = { x: number; y: number };

/**
 * The PROJECTS section (#217 R2): its header with New project, and the tree.
 * New project makes the project and names it right there in the tree — the
 * screen does not move, so a document open in the editor stays open (D12).
 */
export const ProjectsSection = () => {
  const headingId = useId();
  /** where the empty space's or the header's right-click opened New project (#230 D11) */
  const [backgroundMenu, setBackgroundMenu] = useState<Point | null>(null);
  const create = async () => {
    // the + button: named in place only while the screen is the one it was
    // asked from and the focus is still there, in the tree, or nowhere — not
    // taken from where the user went (#218 D15, #229)
    const asked = screenStamp();
    const from = document.activeElement;
    const id = await newFolder();
    const tree = document.querySelector(`[aria-labelledby="${CSS.escape(headingId)}"]`);
    if (id && stillOnScreen(asked, { where: [from, tree] })) {
      useTreeStore.getState().setRenaming(id);
    }
  };
  const onBackgroundMenu = (e: React.MouseEvent) => {
    // the name field keeps the webview's own menu (cut, copy, paste)
    if ((e.target as Element).closest("input")) return;
    e.preventDefault();
    setBackgroundMenu(besidePointer({ x: e.clientX, y: e.clientY }));
  };
  return (
    <>
      <div
        onContextMenu={onBackgroundMenu}
        className="mt-3.5 flex h-6 flex-none items-center pl-2 pr-0.5"
      >
        <h2
          id={headingId}
          className="m-0 flex-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-strong"
        >
          Projects
        </h2>
        <button
          type="button"
          aria-label="New project"
          onClick={() => void create()}
          className={`flex h-5 w-5 items-center justify-center rounded-[4px] text-icon transition-colors hover:bg-hover ${FOCUS_RING}`}
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <LibraryTree labelledBy={headingId} onBackgroundMenu={onBackgroundMenu} />
      {backgroundMenu ? (
        <Menu
          at={backgroundMenu}
          label="Projects"
          items={[
            {
              label: "New project",
              icon: FolderPlus,
              takesFocus: true,
              onSelect: () => void create(),
            },
          ]}
          onSelect={(item) => {
            setBackgroundMenu(null);
            item.onSelect();
          }}
          onClose={() => setBackgroundMenu(null)}
        />
      ) : null}
    </>
  );
};

/**
 * The tree, or what stands in for it: placeholders while the first listing
 * is slow, the failure with Try again, or the empty library (R2).
 */
export const LibraryTree = ({
  labelledBy,
  onBackgroundMenu,
}: {
  labelledBy: string;
  /** a right-click on the list's empty space (#230 D11) */
  onBackgroundMenu?: (e: React.MouseEvent) => void;
}) => {
  const folders = useLibraryStore((s) => s.folders);
  const readFailed = useLibraryStore((s) => s.readFailed);
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // the first listing (D8): Home lists on show, so only an editor that is up
    // without one ever listed — opened from the OS, say — asks here
    if (useLibraryStore.getState().folders === null && useAppStore.getState().view !== "home") {
      refreshLibraryQuietly();
    }
    const timer = setTimeout(() => setSlow(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (folders === null) {
    return slow ? (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading projects"
        className="mt-0.5 flex min-h-0 flex-1 flex-col gap-px"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-[30px] items-center pl-6">
            <div className="h-2 w-28 animate-pulse rounded-sm bg-hover" />
          </div>
        ))}
      </div>
    ) : (
      <div className="min-h-0 flex-1" />
    );
  }
  if (folders.length === 0) {
    const retry = () => {
      setRetrying(true);
      void useLibraryStore
        .getState()
        .refresh()
        .catch(toastError)
        .finally(() => setRetrying(false));
    };
    return (
      <div
        onContextMenu={onBackgroundMenu}
        className="min-h-0 flex-1 px-2 py-1.5 text-[12px] text-muted"
      >
        {readFailed ? (
          <>
            <p className="m-0">Couldn't load projects</p>
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className={`-ml-1.5 mt-1 h-6 rounded-[5px] px-1.5 font-medium text-ink transition-colors hover:bg-hover disabled:opacity-50 ${FOCUS_RING}`}
            >
              Try again
            </button>
          </>
        ) : (
          <p className="m-0">No projects yet</p>
        )}
      </div>
    );
  }
  return <TreeBody folders={folders} labelledBy={labelledBy} onBackgroundMenu={onBackgroundMenu} />;
};

/** the screen reader's name of a row (D29, #229 D6) */
const rowName = (node: TreeNode): string =>
  node.kind === "diagram"
    ? `${node.title}, diagram, edited ${relativeTime(node.diagram.updatedAt)}`
    : `${node.folder.name}, ${node.kind}, ${plural(node.count, "item")}`;

const shownName = (node: TreeNode): string =>
  node.kind === "diagram" ? node.title : node.folder.name;

/**
 * Shows the row's `…` in place of its count while the row has keyboard focus
 * — hover does it on the row itself. Its own row only: the treeitem holds its
 * children too.
 */
const MORE_ON_FOCUS =
  "[&:focus-visible>[data-row]_[data-more]]:flex [&:focus-visible>[data-row]_[data-count]]:hidden [&:focus-visible>[data-row]_[data-tail]]:flex";

/**
 * The row's right end — its count, its `…` on hover — stuck to the list's
 * visible right edge over a 12px fade of the row's own fill, so a name that
 * runs under it fades out (Sidebar-Deep): the digit ends 8 in.
 */
const TAIL =
  "sticky right-0 flex-none self-stretch items-center rounded-r-[5px] bg-[linear-gradient(to_right,transparent,var(--row-bg)_12px)] pl-3 pr-2";

/** a row's own controls — a double click on them does not open the row (#220), nor does a press there drag it (#230 D9) */
const ROW_CONTROLS = "[data-chevron],[data-more],input";

/**
 * The 2px insertion line's left end — the slot's level's indent (#230 D9):
 * 4 + 16 per level after the first, as the rows' own. Static classes, for
 * Tailwind.
 */
const LINE_LEFT = [
  "left-1",
  "left-5",
  "left-9",
  "left-13",
  "left-17",
  "left-21",
  "left-25",
  "left-29",
  "left-33",
  "left-37",
  "left-41",
] as const;
const lineLeft = (level: number): string =>
  LINE_LEFT[Math.min(Math.max(level, 1), LINE_LEFT.length) - 1]!;

/** the tree scrolls by itself while a drag is this near its top or bottom edge (#230 D9) */
const SCROLL_EDGE = 24;
/** … at most this much a frame */
const SCROLL_STEP = 12;

/** a row being dragged (#230 D9): what, where the pointer is, and where it would land */
interface Drag {
  node: TreeNode;
  at: Point;
  target: DropTarget | null;
}

/** whether `key` — a folder's or a diagram's — is still listed */
const listed = (folders: FolderMeta[], key: TreeKey): boolean => {
  const item = parseItemKey(key);
  if (!item) return false;
  return item.kind === "diagram"
    ? findDiagram(folders, item.id) !== null
    : findFolder(folders, item.id) !== null;
};

const TreeBody = ({
  folders,
  labelledBy,
  onBackgroundMenu,
}: {
  folders: FolderMeta[];
  labelledBy: string;
  onBackgroundMenu?: (e: React.MouseEvent) => void;
}) => {
  const view = useAppStore((s) => s.view);
  const homeView = useAppStore((s) => s.homeView);
  const tabs = useAppStore((s) => s.tabs);
  const projectId = useDiagramStore((s) => s.projectId);
  const title = useDiagramStore((s) => s.title);
  const expanded = useTreeStore((s) => s.expanded);
  const renaming = useTreeStore((s) => s.renaming);
  const reveal = useTreeStore((s) => s.reveal);
  const picked = useTreeStore((s) => s.picked);

  // every open diagram (#218 D19): the one on screen as the store has it, the
  // others as their tabs keep them; a tab not read yet shows the listing
  const opens = useMemo<LiveDiagram[]>(() => {
    const kept = tabs.flatMap((t) =>
      t.doc?.projectId ? [{ id: t.doc.projectId, title: t.doc.title }] : [],
    );
    return projectId ? [{ id: projectId, title }, ...kept] : kept;
  }, [tabs, projectId, title]);
  const tree = useMemo(() => buildTree(folders, opens), [folders, opens]);
  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  // what a click picked, else where the app is (#230 D8)
  const selected = picked ?? selectedKey({ view, homeView, folders, projectId });

  const [focusKey, setFocusKey] = useState<TreeKey | null>(null);
  /** the row menu: from the row's `…` (or Shift+F10), or a right-click at the pointer (#230 D11) */
  const [menu, setMenu] = useState<{ node: TreeNode; at: Point; from: "more" | "pointer" } | null>(
    null,
  );
  /** the `…` (or row) the menu opened from — pressing it again closes it (#220) */
  const menuOpener = useRef<HTMLElement | null>(null);
  const items = useRef(new Map<TreeKey, HTMLLIElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const startDrag = usePointerDrag();
  /** drops the drag under way without a word — the item went from the listing */
  const dropDrag = useRef<() => void>(() => undefined);
  /** the click after a drag is no pick (#230 D9) */
  const swallowClick = useRef(false);
  /** what the drag reads between renders: the pointer, the rows, the listing */
  const live = useRef({ at: null as Point | null, rows: [] as typeof rows, folders });
  /** the live region's words — each a new line, by its count, so the same words are heard again (#230 D14) */
  const [notice, setNotice] = useState({ text: "", n: 0 });
  const announce = (text: string) => setNotice((now) => ({ text, n: now.n + 1 }));
  /** a row to put focus on once it is rendered */
  const focusNext = useRef<TreeKey | null>(null);
  /** the tree list — where the focus may be taken back from (#218 D15) */
  const treeBox = useRef<HTMLUListElement>(null);

  const shown = (key: TreeKey | null): key is TreeKey =>
    key !== null && rows.some((r) => r.key === key);
  // roving tabindex: one stop — the last focused row, else the selected one, else the first
  const tabStop = shown(focusKey) ? focusKey : shown(selected) ? selected : (rows[0]?.key ?? null);

  // a render that only has to place the focus (the row's key did not change)
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const focusRow = (key: TreeKey) => {
    setFocusKey(key);
    focusNext.current = key;
    redraw();
  };
  useLayoutEffect(() => {
    if (!focusNext.current) return;
    items.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  });

  // the diagram just opened scrolls into view (D7), whichever tree is mounted
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows is the trigger — the row appears once its project unfolds
  useEffect(() => {
    if (!reveal) return;
    const el = items.current.get(reveal);
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest" });
    useTreeStore.getState().clearReveal();
  }, [reveal, rows]);

  /**
   * A click or Space (#230 D8): the row is selected and nothing else — the
   * screen stays, so the second click of a double click lands on the same row.
   */
  const pickRow = (node: TreeNode) => {
    useTreeStore.getState().pick(node.key);
    setFocusKey(node.key);
  };

  /**
   * A row's click: a pick — but not the click a drag's release makes (#230
   * D9), nor the one a macOS ctrl+click (its right-click) may make (#230) —
   * off macOS a ctrl+click is a click.
   */
  const onRowClick = (node: TreeNode, e: React.MouseEvent) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (isMacContextClick(e)) return;
    pickRow(node);
  };

  /**
   * A double click or Enter (#230 D8): a diagram opens in its tab; a project
   * or a folder is what Home shows, its row unfolded (never folded).
   */
  const openRow = (node: TreeNode) => {
    if (node.kind === "diagram") {
      void openFromLibrary(node.diagram.id);
      return;
    }
    viewInHome({ kind: "folder", folder: node.folder.id });
    useTreeStore.getState().expand([node.key]);
  };

  /** somewhere to move a diagram to: more than one real folder (#229 D13) */
  const movable = canMoveDiagrams(folders);
  /** a row's `…` (D10); none for a stray listing with no folder behind it */
  const menuItems = (node: TreeNode): MenuItem[] | null => {
    if (node.kind !== "diagram") {
      const { folder } = node;
      // a folder's Move to… — never a project's (#230 D12); somewhere to go besides where it is
      const parent =
        node.kind === "folder" ? findFolder(folders, folder.id)?.path.at(-2) : undefined;
      const items = folderMenuItems(folder, () => useTreeStore.getState().setRenaming(folder.id), {
        move:
          parent && canMoveFolder(folders, folder.id)
            ? folderMovePicker(folder, folders, parent.id, {
                expanded: unfoldedFolders(),
                // as a diagram's (#229): the row follows the folder —
                // the folders above it unfold and it takes the focus again — only
                // while the screen is the one it was asked from and the focus is
                // still in the tree or nowhere (#218 D15, #229)
                move: (target) => {
                  const asked = screenStamp();
                  void moveFolderTo(folder, target).then((moved) => {
                    if (!moved || !stillOnScreen(asked, { where: [treeBox.current] })) return;
                    const listed = useLibraryStore.getState().folders ?? [];
                    const above = findFolder(listed, folder.id)?.path.slice(0, -1) ?? [];
                    useTreeStore.getState().expand(above.map((f) => folderKey(f.id)));
                    focusRow(node.key);
                  });
                },
              })
            : undefined,
        // a folder inside it: the row unfolds and the new one is named in place
        // (#229 D11) — none at the deepest level
        newFolder: canHoldFolders(folders, folder.id)
          ? () => {
              const asked = screenStamp();
              void newFolder({ parent: folder.id }).then((id) => {
                // named in place only while the screen and the focus have not
                // gone elsewhere (#218 D15, #229)
                if (!id || !stillOnScreen(asked, { where: [treeBox.current] })) return;
                useTreeStore.getState().expand([node.key]);
                useTreeStore.getState().setRenaming(id);
              });
            }
          : undefined,
      });
      return items.length > 0 ? items : null;
    }
    // the open diagram's live title is the one the dialog should name
    const diagram = { ...node.diagram, title: node.title };
    return diagramMenuItems(
      diagram,
      movable
        ? diagramMovePicker(diagram, folders, node.folder.id, {
            expanded: unfoldedFolders(),
            // the row follows the diagram: once the listing has it in its new
            // folder, the folders above it unfold and it takes the focus again
            // — left on the old row, the focus would fall to the page, out of
            // the tree's Backspace guard (#229)
            // — only while the screen is the one it was asked from and the
            // focus is still in the tree or nowhere: where the user went
            // meanwhile keeps it (#218 D15)
            move: (target) => {
              const asked = screenStamp();
              void moveDiagram(diagram, target).then((moved) => {
                if (!moved || !stillOnScreen(asked, { where: [treeBox.current] })) return;
                useTreeStore
                  .getState()
                  .expand(openKeys(useLibraryStore.getState().folders, diagram.id));
                focusRow(diagramKey(diagram.id));
              });
            },
          })
        : null,
      // Rename edits the title in its tab (#219 D3) — the field takes the
      // focus; a diagram that could not be opened gives it back to the row (#219)
      // — while the screen and the focus have not gone on (#218 D15, #230)
      {
        onRenameFailed: (asked) => {
          if (stillOnScreen(asked, { where: [treeBox.current] })) focusRow(node.key);
        },
      },
    );
  };

  const openMenu = (node: TreeNode, anchor: Element | null) => {
    if (!anchor || !menuItems(node)) return;
    const box = anchor.getBoundingClientRect();
    menuOpener.current = anchor instanceof HTMLElement ? anchor : null;
    setMenu({ node, at: { x: box.left, y: box.bottom + 4 }, from: "more" });
  };

  /**
   * A right-click on a row (#230 D11): its menu at the pointer. The selection
   * stays; the row keeps a hover tint while the menu is open. A stray
   * listing has no menu — and no webview menu either. The name field keeps
   * the webview's (cut, copy, paste).
   */
  const onRowMenu = (node: TreeNode, e: React.MouseEvent) => {
    if ((e.target as Element).closest("input")) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag || !menuItems(node)) return;
    menuOpener.current = null;
    setFocusKey(node.key);
    setMenu({
      node,
      at: besidePointer({ x: e.clientX, y: e.clientY }),
      from: "pointer",
    });
  };

  live.current.rows = rows;
  live.current.folders = folders;

  /**
   * where the drag would land with the pointer at `at` — none outside the
   * list's width; above or below the list, at its visible edge, never on a row
   * the scroll hides there (#230) — while it scrolls by itself, the
   * slot follows the edge. Scrolled to the top, the edge is the first row's,
   * under the list's top padding (#230)
   */
  const targetAt = (dragged: TreeNode, at: Point): DropTarget | null => {
    const box = treeBox.current?.getBoundingClientRect();
    if (!box || at.x < box.left || at.x > box.right) return null;
    const boxes = new Map<TreeKey, RowBox>();
    for (const row of live.current.rows) {
      const line = items.current.get(row.key)?.querySelector(":scope > [data-row]");
      if (!line) continue;
      const { top, bottom } = line.getBoundingClientRect();
      boxes.set(row.key, { top, bottom });
    }
    const first = boxes.values().next().value;
    const top = Math.max(box.top, first?.top ?? box.top) + 1;
    return dropAt({
      rows: live.current.rows,
      boxes,
      y: Math.min(Math.max(at.y, top), box.bottom - 1),
      dragged: dragged.key as ItemKey,
      folders: live.current.folders,
    });
  };

  /** the drop (#230 D9, D13): the item goes, the screen first; focus to it, or to the folder it went into */
  const drop = (node: TreeNode, target: DropTarget) => {
    const key = node.key as ItemKey;
    // read now, not when the press began: a listing may have landed meanwhile
    const now = live.current.folders;
    const before = siblingsOf(now, key);
    void placeItem(key, target.placement);
    const hidden = target.kind === "into" && !useTreeStore.getState().expanded.has(target.row);
    focusRow(hidden ? target.row : node.key);
    if (before && before.parent === target.placement.parent) {
      announce(placementNotice(now, shownName(node), target.placement, before.keys.length));
    }
  };

  const onRowPointerDown = (node: TreeNode, e: React.PointerEvent) => {
    swallowClick.current = false;
    // the primary button only — a ctrl+click is macOS's right-click (#230 D9)
    if (e.button !== 0 || isMacContextClick(e)) return;
    if ((e.target as Element).closest(ROW_CONTROLS)) return;
    // the stray listing has no order and no folder to move; a row whose name
    // is being edited stays put (#230)
    if (node.kind !== "diagram" && (node.folder.stray || renaming === node.folder.id)) return;
    /** the release's click, if any, comes right after it — no later than this */
    const forgetSwallow = () =>
      setTimeout(() => {
        swallowClick.current = false;
      }, 0);
    dropDrag.current = startDrag(e, (p) => p, {
      onStart: (at) => {
        swallowClick.current = true;
        setMenu(null);
        live.current.at = at;
        setDrag({ node, at, target: null });
      },
      onMove: (at) => {
        live.current.at = at;
        setDrag({ node, at, target: targetAt(node, at) });
      },
      onEnd: (at) => {
        const target = targetAt(node, at);
        live.current.at = null;
        setDrag(null);
        forgetSwallow();
        if (target) drop(node, target);
      },
      onCancel: () => {
        live.current.at = null;
        setDrag(null);
        forgetSwallow();
      },
    });
  };

  // the list scrolls by itself near its edges while a drag is on (#230 D9)
  const dragging = drag !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: one loop per drag; it reads the live pointer
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const box = treeBox.current?.getBoundingClientRect();
      const at = live.current.at;
      if (box && at && at.x >= box.left && at.x <= box.right) {
        const above = box.top + SCROLL_EDGE - at.y;
        const below = at.y - (box.bottom - SCROLL_EDGE);
        const by =
          above > 0
            ? -Math.ceil(SCROLL_STEP * Math.min(1, above / SCROLL_EDGE))
            : below > 0
              ? Math.ceil(SCROLL_STEP * Math.min(1, below / SCROLL_EDGE))
              : 0;
        const list = treeBox.current;
        // at either end already, nothing moves and the slot stays (#230)
        const top = list
          ? Math.min(Math.max(list.scrollTop + by, 0), list.scrollHeight - list.clientHeight)
          : 0;
        if (list && top !== list.scrollTop) {
          list.scrollTop = top;
          setDrag((now) => (now ? { ...now, target: targetAt(now.node, at) } : now));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  // the item dragged went from the listing (deleted elsewhere): the drag is over
  useEffect(() => {
    if (drag && !listed(folders, drag.node.key)) {
      dropDrag.current();
      setDrag(null);
    }
  }, [folders, drag]);

  /**
   * ⌥↑/⌥↓ (#230 D10): one place among its siblings — the screen at once, the
   * write after; the focus stays on the row. Into another folder is Move to….
   */
  const stepRow = (node: TreeNode, dir: -1 | 1) => {
    const key = node.key as ItemKey;
    const step = keyboardStep(folders, key, dir);
    if (!step) return;
    const name = shownName(node);
    if ("edge" in step) {
      announce(`“${name}” is already ${step.edge}`);
      return;
    }
    void placeItem(key, step);
    focusRow(node.key);
    announce(placementNotice(folders, name, step, step.count));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    // the rename field's keys are its own
    if (target.tagName === "INPUT") return;
    const li = target.closest<HTMLLIElement>("[data-key]");
    const row = li ? rows.find((r) => r.key === li.dataset.key) : undefined;
    if (!li || !row) return;
    const handled = () => {
      // canvasKeymap listens on the window: Enter would start a label edit,
      // Shift+F10 open the selection's menu (D27)
      e.preventDefault();
      e.stopPropagation();
    };
    if ((e.key === "Enter" || e.key === " ") && target === li) {
      handled();
      if (e.key === "Enter") openRow(row.node);
      else pickRow(row.node);
      return;
    }
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      handled();
      openMenu(row.node, li.querySelector("[data-more]") ?? li.querySelector("[data-row]"));
      return;
    }
    if (e.key === "F2" && row.node.kind !== "diagram" && !row.node.folder.stray) {
      handled();
      useTreeStore.getState().setRenaming(row.node.folder.id);
      return;
    }
    if (
      e.altKey &&
      !(e.metaKey || e.ctrlKey || e.shiftKey) &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      handled();
      stepRow(row.node, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const action = treeKeyAction(rows, row.key, e.key);
    if (!action) return;
    handled();
    if (action.expand) useTreeStore.getState().expand([action.expand]);
    if (action.collapse) useTreeStore.getState().collapse(action.collapse);
    if (action.focus) focusRow(action.focus);
  };

  const renderItem = (node: TreeNode, level: number) => {
    const expandable = node.kind !== "diagram" && node.expandable;
    const open = expandable && expanded.has(node.key);
    const isSelected = node.key === selected;
    const actions = menuItems(node);
    const menuOpen = menu?.node.key === node.key;
    // opened from the `…`, the `…` stays shown; from a right-click, the row's tint says it
    const moreOpen = menuOpen && menu?.from === "more";
    // the row keeps its count, not its `…`, while the pointer still rests on it (Sidebar-States ①②)
    const pointerOpen = menuOpen && menu?.from === "pointer";
    const tinted = pointerOpen && !isSelected;
    /** the `…` shows only on hover — not while a drag or a right-click menu holds the row */
    const quiet = drag !== null || pointerOpen;
    // a drag: the row it would fill (into a folder) and the row its line is drawn on (#230 D9)
    const dropInto = drag?.target?.kind === "into" && drag.target.row === node.key;
    const line =
      drag?.target?.kind === "slot" && drag.target.line.row === node.key ? drag.target.line : null;
    const ghost = drag?.node.key === node.key;
    // a folder counts what is in it — none shows no number (#229 D6); a diagram has no count
    const count = node.kind !== "diagram" && node.count > 0 ? node.count : null;
    const chevronTone = isSelected ? "text-ink" : "text-icon";
    const children = node.kind === "diagram" ? [] : node.children;
    return (
      <li
        key={node.key}
        ref={(el) => {
          if (el) items.current.set(node.key, el);
          else items.current.delete(node.key);
        }}
        data-key={node.key}
        role="treeitem"
        aria-level={level}
        aria-expanded={expandable ? open : undefined}
        aria-selected={isSelected}
        aria-label={rowName(node)}
        // the stray listing has no order to move in (#230 D7, D14)
        aria-keyshortcuts={node.folder.stray ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
        tabIndex={node.key === tabStop ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setFocusKey(node.key);
        }}
        className={`flex flex-col gap-px ${FOCUS_TREE_ROW} ${MORE_ON_FOCUS} ${ghost ? "opacity-40" : ""}`}
      >
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard reaches the row through its treeitem (roving tabindex, Enter/Space) */}
        <div
          data-row
          onPointerDown={(e) => onRowPointerDown(node, e)}
          onClick={(e) => onRowClick(node, e)}
          onContextMenu={(e) => onRowMenu(node, e)}
          onDoubleClick={(e) => {
            // the chevron, the `…` and the name field stop only their clicks:
            // a double click on them folds, toggles the menu or picks a word
            if ((e.target as Element).closest(ROW_CONTROLS)) return;
            openRow(node);
          }}
          // as wide as the widest row: names are never cut, the list scrolls
          // sideways instead (Sidebar-Deep); --row-bg is the fill the tail fades into
          // select-none: a press that turns into a drag picks no words (#230 D9)
          className={`group/row relative flex h-[30px] cursor-default select-none items-center gap-1 rounded-[5px] text-[13px] text-ink ${
            count !== null ? "pr-0" : "pr-2"
          } ${indentClass(level)} ${
            dropInto
              ? `${DROP_TARGET} ${isSelected ? "font-semibold" : "font-medium"}`
              : isSelected
                ? "bg-selected font-semibold [--row-bg:var(--selected)]"
                : tinted
                  ? "bg-hover font-medium [--row-bg:var(--hover)]"
                  : drag
                    ? "font-medium [--row-bg:var(--frame)]"
                    : "font-medium [--row-bg:var(--frame)] hover:bg-hover hover:[--row-bg:var(--hover)]"
          }`}
        >
          {line ? (
            // inside the row: the row is as wide as the widest, so the line reaches its end even scrolled sideways (Sidebar-Deep)
            <span
              data-drop-line=""
              aria-hidden="true"
              className={`pointer-events-none absolute right-1 z-10 h-0.5 rounded-[1px] bg-ink ${lineLeft(
                line.level,
              )} ${line.edge === "top" ? "-top-[1.5px]" : "-bottom-[1.5px]"}`}
            />
          ) : null}
          {expandable ? (
            <span
              data-chevron
              aria-hidden="true"
              onClick={(e) => {
                // the chevron only folds — the row's click selects, its double click opens (#230 D8)
                e.stopPropagation();
                useTreeStore.getState().toggle(node.key);
              }}
              className={`flex h-3.5 w-3.5 flex-none items-center justify-center ${chevronTone}`}
            >
              {open ? (
                <ChevronDown size={14} strokeWidth={2} />
              ) : (
                <ChevronRight size={14} strokeWidth={2} />
              )}
            </span>
          ) : (
            <span aria-hidden="true" className="w-3.5 flex-none" />
          )}
          {/* a top row (a project, or the stray listing) shows its badge; a folder
              its Folder, FolderOpen while unfolded (#229 D6) — coloured by kind,
              selected or not (#236 D2·D3) */}
          {node.kind === "diagram" ? (
            <DiagramGlyph />
          ) : node.kind === "folder" ? (
            <FolderGlyph open={open} />
          ) : (
            <ProjectBadge id={node.folder.id} name={node.folder.name} />
          )}
          {node.kind !== "diagram" && renaming === node.folder.id ? (
            <NameInput
              size="sm"
              name={node.folder.name}
              label={node.kind === "project" ? "Project name" : "Folder name"}
              onDone={(name) => {
                // Enter or Escape leave focus in the field: give it back to the
                // row. A click elsewhere has already put it where it belongs.
                const fromKeyboard = document.activeElement?.tagName === "INPUT";
                useTreeStore.getState().setRenaming(null);
                if (fromKeyboard) focusRow(node.key);
                if (name !== null) void renameFolderTo(node.folder, name);
              }}
            />
          ) : (
            <span className="ml-0.5 flex-[1_0_auto] whitespace-nowrap">{shownName(node)}</span>
          )}
          {actions || count !== null ? (
            <span
              data-tail
              // a row with no count shows its tail only with the `…`
              className={`${TAIL} ${
                count !== null || moreOpen
                  ? "flex"
                  : quiet
                    ? "hidden"
                    : "hidden group-hover/row:flex"
              }`}
            >
              {actions ? (
                <button
                  type="button"
                  data-more
                  aria-label={`Actions for ${shownName(node)}`}
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (moreOpen) setMenu(null);
                    else openMenu(node, e.currentTarget);
                  }}
                  className={`h-5 w-5 flex-none items-center justify-center rounded-[4px] text-icon hover:bg-selected ${
                    moreOpen ? "flex" : quiet ? "hidden" : "hidden group-hover/row:flex"
                  }`}
                >
                  <Ellipsis size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
              {count !== null ? (
                <span
                  data-count
                  aria-hidden="true"
                  className={`flex-none text-[12px] font-medium text-muted-strong ${
                    actions ? (moreOpen ? "hidden" : quiet ? "" : "group-hover/row:hidden") : ""
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </span>
          ) : null}
          {/* last in the row: painted over the sticky tail's fill */}
          {dropInto ? <span data-drop-ring="" aria-hidden="true" className={DROP_RING} /> : null}
        </div>
        {open ? (
          // biome-ignore lint/a11y/useSemanticElements: the WAI-ARIA tree's child list is a group
          <ul role="group" className="m-0 flex list-none flex-col gap-px p-0">
            {children.map((child) => renderItem(child, level + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <ul
        ref={treeBox}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the WAI-ARIA tree pattern, keyboard and all
        role="tree"
        data-dragging={drag ? "" : undefined}
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        // a row's right-click is its own (it stops here); the rest is the list's empty space
        onContextMenu={onBackgroundMenu}
        // nodelete: Backspace on a row must not delete the canvas selection (D27)
        // one column as wide as the widest row (and at least the list's): deep
        // rows scroll sideways, the list alone, on both axes (Sidebar-Deep);
        // a padding, not a margin, on top: the first row's drop line stays
        // inside the scroll box (#230)
        className="nodelete m-0 grid min-h-0 flex-1 list-none grid-cols-[minmax(max-content,1fr)] content-start gap-y-px overflow-auto px-0 pb-0 pt-0.5"
      >
        {tree.map((project) => renderItem(project, 1))}
      </ul>
      {drag ? <TreeDragLayer node={drag.node} at={drag.at} /> : null}
      {/* a live region that stays mounted (as the toasts'): each notice is a new
          line inside it, so the same words are heard again (#230) */}
      <div role="status" aria-live="polite" className="sr-only">
        {notice.text ? <p key={notice.n}>{notice.text}</p> : null}
      </div>
      {menu ? (
        <Menu
          at={menu.at}
          label={shownName(menu.node)}
          items={menuItems(menu.node) ?? []}
          opener={menuOpener}
          onSelect={(item) => {
            const key = menu.node.key;
            setMenu(null);
            if (!item.takesFocus) focusRow(key);
            item.onSelect();
          }}
          onClose={(returnFocus) => {
            const key = menu.node.key;
            setMenu(null);
            if (returnFocus) focusRow(key);
          }}
        />
      ) : null}
    </>
  );
};
