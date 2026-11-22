import { Check, ChevronDown, ChevronRight } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { POPUP_MARGIN, placePopup } from "../../shared/lib/usePopupPosition";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { DiagramGlyph, FolderGlyph } from "../../shared/ui/KindGlyph";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";
import { type FolderMeta, itemKey, type ProjectMeta } from "./libraryApi";
import { moveDiagram, moveFolderTo } from "./libraryActions";
import { canPlace, findFolder, folderList, takesItems } from "./libraryTree";
import { indentClass } from "./libraryParts";

/**
 * Move to… (#229 D13) — the canvas's `#move-picker` (Hybrid-Project-Cards,
 * v33): a popover beside the menu it came from, its title row level with the
 * Move to… item, holding the sidebar tree with destinations only — projects
 * and folders, no diagrams, no counts, no project not found (`takesItems`, #253 R7). The current parent
 * is ticked and cannot be picked; its chevron still works. It opens with the
 * path to the current parent unfolded. A row's click or Enter moves there and
 * closes; a chevron only folds. ↑↓, → (unfold / first child), ← (fold /
 * parent), Enter, and Escape back to the menu.
 *
 * `unavailable` greys out targets the item cannot go to — a folder and
 * everything under it, when #230 moves folders (`#move-picker-folder`).
 */

/** the picker's box: 240 wide, at most 320 tall */
const WIDTH = 240;
/** between the menu and the picker */
const GAP = 4;
/** the picker's own padding — its title row starts this far below its top */
const PAD = 4;

/** where the picker goes beside `menu`, its title row level with `item`; the left side when the right has no room */
export const pickerPlace = (
  menu: DOMRect,
  item: DOMRect,
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } => {
  const right = menu.right + GAP;
  const left =
    right + size.width + POPUP_MARGIN <= view.width
      ? right
      : Math.max(POPUP_MARGIN, menu.left - GAP - size.width);
  const wanted = item.top - PAD;
  const top =
    wanted + size.height + POPUP_MARGIN <= view.height
      ? Math.max(POPUP_MARGIN, wanted)
      : Math.max(POPUP_MARGIN, view.height - size.height - POPUP_MARGIN);
  return { left, top };
};

/** where a picker opens: beside a menu (its Move to… item), or at a point (a header button) */
export type PickerPlace = { menu: DOMRect; item: DOMRect } | { at: { x: number; y: number } };

interface Row {
  folder: FolderMeta;
  level: number;
  parent: string | null;
  /** has folders under it — what the chevron unfolds */
  expandable: boolean;
  expanded: boolean;
}

/** a folder's own folders, newest first — the listing's (and `childrenOf`'s) order */
const subFolders = (folder: FolderMeta): FolderMeta[] => folder.folders;

export const MovePicker = ({
  folders,
  moving,
  current,
  unavailable,
  place,
  opener,
  onMove,
  onBack,
  onClose,
  onDismiss,
  expanded: sidebarExpanded,
  id,
}: {
  folders: FolderMeta[];
  /** what is being moved — named in the title row */
  moving: { name: string; kind: "diagram" | "folder" };
  /** the folder it is in now — ticked, not a target */
  current: string;
  /** folders it cannot go to, greyed out (#230's folder move: itself and everything under it) */
  unavailable?: ReadonlySet<string>;
  /** folders unfolded as it opens — the sidebar's; the path to `current` unfolds anyway */
  expanded?: ReadonlySet<string>;
  /** the tree's id — what the opening item's `aria-controls` names */
  id?: string;
  place: PickerPlace;
  /** pressing this is not "outside" (the button that opened it) */
  opener?: RefObject<HTMLElement | null>;
  onMove: (folder: string) => void;
  /** Escape: back to the menu */
  onBack: () => void;
  /** a press outside it */
  onClose?: () => void;
  /** Tab: the menu closes and the focus goes on */
  onDismiss?: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLUListElement>(null);
  const titleId = useId();
  const movingId = useId();
  const roots = useMemo(() => folders.filter(takesItems), [folders]);
  // as the sidebar has it, and the path to the current parent (#229)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () =>
      new Set([
        ...(sidebarExpanded ?? []),
        ...(findFolder(roots, current)?.path.map((f) => f.id) ?? []),
      ]),
  );
  const [focusId, setFocusId] = useState<string>(() =>
    findFolder(roots, current) ? current : (roots[0]?.id ?? ""),
  );
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  useOutsideDismiss(ref, onClose !== undefined, () => onClose?.(), { ignore: opener });

  const rows = useMemo(() => {
    const out: Row[] = [];
    const add = (folder: FolderMeta, level: number, parent: string | null) => {
      const expandable = subFolders(folder).length > 0;
      const open = expandable && expanded.has(folder.id);
      out.push({ folder, level, parent, expandable, expanded: open });
      if (open) for (const sub of subFolders(folder)) add(sub, level + 1, folder.id);
    };
    for (const root of roots) add(root, 1, null);
    return out;
  }, [roots, expanded]);

  const blocked = (id: string) => id === current || (unavailable?.has(id) ?? false);

  // placed before paint: beside the menu, or at the point, kept on screen —
  // and again when unfolding makes it taller (#229)
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows.length is the trigger — its height changes with it
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = { width: WIDTH, height: el.offsetHeight };
    const view = { width: window.innerWidth, height: window.innerHeight };
    setBox(
      "menu" in place
        ? pickerPlace(place.menu, place.item, size, view)
        : placePopup(place.at, size, view),
    );
  }, [place, rows.length]);

  // focus follows the roving stop — on open, the current parent — and its
  // name is brought into view on both axes: a deep row may be off to the
  // right, and the list's scroll-padding keeps it clear of Current (Sidebar-Deep c)
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows is the trigger — a row unfolded or folded is drawn anew
  useLayoutEffect(() => {
    const item = tree.current?.querySelector<HTMLElement>(`[data-folder="${CSS.escape(focusId)}"]`);
    if (!item) return;
    item.focus({ preventScroll: true });
    item
      .querySelector<HTMLElement>(":scope > [data-row] [data-name]")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusId, rows]);

  const toggle = (id: string) =>
    setExpanded((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pick = (id: string) => {
    if (!blocked(id)) onMove(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = rows.findIndex((r) => r.folder.id === focusId);
    const row = rows[at];
    const go = (i: number) => {
      const target = rows[Math.min(Math.max(i, 0), rows.length - 1)];
      if (target) setFocusId(target.folder.id);
    };
    switch (e.key) {
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(rows.length - 1);
        break;
      case "ArrowRight":
        if (row?.expandable && !row.expanded) toggle(row.folder.id);
        else if (row?.expanded) go(at + 1);
        break;
      case "ArrowLeft":
        if (row?.expanded) toggle(row.folder.id);
        else if (row?.parent) setFocusId(row.parent);
        break;
      case "Enter":
        if (row) pick(row.folder.id);
        break;
      case "Escape":
        onBack();
        break;
      case "Tab":
        // as a menu does: it closes, the menu with it, and the focus goes on
        onDismiss?.();
        return;
      default:
        return;
    }
    // the menu's keys, the canvas's keymap and the window's Escape stay out of it
    e.preventDefault();
    e.stopPropagation();
  };

  const renderRow = (row: Row, index: number, all: Row[]): ReactNode => {
    const { folder, level, expandable, expanded: open } = row;
    const here = folder.id === current;
    const off = here || (unavailable?.has(folder.id) ?? false);
    const isProject = level === 1;
    const children = open ? all.filter((r, i) => i > index && r.parent === folder.id) : [];
    const label = `${folder.name}, ${isProject ? "project" : "folder"}${
      here ? ", current location" : off ? ", unavailable" : ""
    }`;
    return (
      <li
        key={folder.id}
        data-folder={folder.id}
        role="treeitem"
        aria-level={level}
        aria-expanded={expandable ? open : undefined}
        aria-selected={false}
        aria-disabled={off ? true : undefined}
        aria-label={label}
        tabIndex={folder.id === focusId ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setFocusId(folder.id);
        }}
        className="flex flex-none flex-col gap-px outline-hidden focus-visible:[&>[data-row]]:bg-hover focus-visible:[&>[data-row]]:[--row-bg:var(--hover)]"
      >
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard reaches the row through its treeitem (Enter) */}
        <div
          data-row=""
          onClick={() => pick(folder.id)}
          // as wide as the widest row: names are never cut, the list scrolls
          // sideways (Sidebar-Deep c); --row-bg is the fill Current fades into
          className={`flex h-[30px] cursor-default items-center gap-1 rounded-(--radius-control) text-[13px] font-medium text-ink [--row-bg:var(--surface)] ${
            here ? "pr-0" : "pr-2"
          } ${off ? "" : "hover:bg-hover hover:[--row-bg:var(--hover)]"} ${indentClass(level)}`}
        >
          {expandable ? (
            <span
              data-chevron=""
              aria-hidden="true"
              onClick={(e) => {
                // the chevron only folds — even on the current or an unavailable row
                e.stopPropagation();
                toggle(folder.id);
              }}
              className="flex h-3.5 w-3.5 flex-none items-center justify-center text-icon"
            >
              {open ? (
                <ChevronDown size={14} strokeWidth={2} />
              ) : (
                <ChevronRight size={14} strokeWidth={2} />
              )}
            </span>
          ) : (
            <span data-spacer="" aria-hidden="true" className="w-3.5 flex-none" />
          )}
          {/* the row's mark fades with its name when it can't be picked (#236, canvas v55) */}
          {isProject ? (
            <ProjectBadge id={folder.id} name={folder.name} className={off ? "opacity-35" : ""} />
          ) : (
            <FolderGlyph open={open} className={off ? "opacity-35" : ""} />
          )}
          <span
            data-name=""
            className={`ml-0.5 flex-[1_0_auto] whitespace-nowrap ${off ? "opacity-35" : ""}`}
          >
            {folder.name}
          </span>
          {here ? (
            // stuck to the list's visible right edge over a 12px fade of the row's fill
            <span
              data-current=""
              className="sticky right-0 flex flex-none items-center gap-1 self-stretch rounded-r-(--radius-control) bg-[linear-gradient(to_right,transparent,var(--row-bg)_12px)] pl-3 pr-2 text-[11px] leading-[14px] text-muted"
            >
              <Check size={13} strokeWidth={2} aria-hidden="true" />
              Current
            </span>
          ) : null}
        </div>
        {children.length > 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: the WAI-ARIA tree's child list is a group
          <ul role="group" className="m-0 flex list-none flex-col gap-px p-0">
            {children.map((child) => renderRow(child, all.indexOf(child), all))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div
      ref={ref}
      data-move-picker=""
      data-tauri-drag-region="false"
      style={box ?? { left: -9999, top: -9999 }}
      // nodelete: Backspace here must not delete the canvas selection
      className="nodelete fixed z-50 flex max-h-80 w-60 flex-col rounded-(--radius-island) bg-surface p-1 shadow-popover"
    >
      <div className="flex h-7 flex-none items-center gap-2 px-2">
        <span id={titleId} className="flex-none text-[12px] font-semibold leading-4 text-ink">
          Move to
        </span>
        {/* what is moving, read once as the tree's description (#229) */}
        <span id={movingId} className="sr-only">{`Moving ${moving.name}`}</span>
        <span
          aria-hidden="true"
          className="flex min-w-0 flex-1 items-center justify-end gap-[5px] text-[11px] leading-[14px] text-muted"
        >
          {moving.kind === "folder" ? <FolderGlyph size={13} /> : <DiagramGlyph size={13} />}
          <span className="truncate">{moving.name}</span>
        </span>
      </div>
      <ul
        ref={tree}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the WAI-ARIA tree pattern, keyboard and all
        role="tree"
        id={id}
        aria-labelledby={titleId}
        aria-describedby={movingId}
        onKeyDown={onKeyDown}
        // one column as wide as the widest row: the list scrolls on both axes;
        // the scroll padding is the Current box's width (Sidebar-Deep c)
        className="m-0 grid min-h-0 flex-1 list-none grid-cols-[minmax(max-content,1fr)] content-start gap-y-px overflow-auto scroll-pr-[78px] p-0"
      >
        {rows.map((row, i) => (row.level === 1 ? renderRow(row, i, rows) : null))}
      </ul>
    </div>
  );
};

/**
 * A diagram's Move to… for a `Menu` item (#229 D13): the picker beside the
 * menu, moving `diagram` out of `current`. `done.close` closes the menu once
 * it has moved; `done.back` (Escape) returns to the menu. `move` is how —
 * `moveDiagram`, unless the caller shows the move early (the board).
 */
export const diagramMovePicker =
  (
    diagram: ProjectMeta,
    folders: FolderMeta[],
    current: string,
    {
      expanded,
      move = (target) => void moveDiagram(diagram, target),
    }: {
      /** what the sidebar has unfolded (#229) */
      expanded?: ReadonlySet<string>;
      move?: (target: string) => void;
    } = {},
  ) =>
  (
    place: PickerPlace,
    done: { back: () => void; close: () => void; dismiss: () => void },
    id?: string,
  ): ReactNode => (
    <MovePicker
      folders={folders}
      moving={{ name: diagram.title, kind: "diagram" }}
      current={current}
      expanded={expanded}
      id={id}
      place={place}
      onMove={(target) => {
        done.close();
        move(target);
      }}
      onBack={done.back}
      onDismiss={done.dismiss}
    />
  );

/**
 * Where folder `folder` cannot go (#230 D7, D12): itself, everything under
 * it, and anywhere too deep for what it holds — greyed out in its picker.
 */
const closedTo = (folders: FolderMeta[], folder: FolderMeta): ReadonlySet<string> =>
  new Set(
    folderList(folders)
      .filter(({ folder: f }) => !canPlace(folders, itemKey("folder", folder.id), f.id))
      .map(({ folder: f }) => f.id),
  );

/**
 * A folder's Move to… for a `Menu` item (#230 D12, canvas
 * `#move-picker-folder`): the picker beside the menu, moving `folder` out of
 * `current` to the top of the folder picked — never into itself or under
 * it. `move` is how — `moveFolderTo`, unless the caller says otherwise.
 */
export const folderMovePicker =
  (
    folder: FolderMeta,
    folders: FolderMeta[],
    current: string,
    {
      expanded,
      move = (target) => void moveFolderTo(folder, target),
    }: {
      /** what the sidebar has unfolded (#229) */
      expanded?: ReadonlySet<string>;
      move?: (target: string) => void;
    } = {},
  ) =>
  (
    place: PickerPlace,
    done: { back: () => void; close: () => void; dismiss: () => void },
    id?: string,
  ): ReactNode => (
    <MovePicker
      folders={folders}
      moving={{ name: folder.name, kind: "folder" }}
      current={current}
      unavailable={closedTo(folders, folder)}
      expanded={expanded}
      id={id}
      place={place}
      onMove={(target) => {
        done.close();
        move(target);
      }}
      onBack={done.back}
      onDismiss={done.dismiss}
    />
  );
