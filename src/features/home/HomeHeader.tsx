import { ChevronDown, Ellipsis, Plus } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { belowRightOf, Menu } from "../../shared/ui/Menu";
import { useAppStore } from "../library/appStore";
import { DASHBOARD, type HomeView, resolveHomeView } from "../library/homeView";
import type { FolderMeta } from "../library/libraryApi";
import { plural, renameFolderTo } from "../library/libraryActions";
import { folderMenuItems } from "../library/libraryMenus";
import { NameInput } from "../library/libraryParts";
import { useLibraryStore } from "../library/libraryStore";
import {
  allDiagrams,
  canHoldFolders,
  canMoveFolder,
  findFolder,
  isMissing,
  itemCount,
} from "../library/libraryTree";
import { folderMovePicker } from "../library/MovePicker";
import { focusHomeTitleIfStill, viewInHome } from "../library/navigation";
import { type Crumb, PathCrumbs } from "../library/PathCrumbs";
import { relativeTime } from "../library/relativeTime";
import { unfoldedFolders } from "../sidebar/treeStore";
import { CardSizeButton } from "./CardSizeButton";
import { type HomeMode, useHomeMode } from "./homeMode";
import { INK_FILL } from "./homeStyles";
import { inSheet, NewMenu, newFolderFromHome } from "./NewMenu";
import { PathCard, usePathCard } from "./PathCard";
import { ViewSwitch } from "./ViewSwitch";

type Point = { x: number; y: number };

/**
 * The id of the board's "Library" step in the path (#231 D3) — never a
 * folder's: a folder id is `[A-Za-z0-9_-]` (`validate_id`).
 */
export const LIBRARY_CRUMB = ":library";

const LIBRARY: Crumb = { id: LIBRARY_CRUMB, name: "Library" };

/** what Home's header row holds for a view and mode (#231 D2's slot table) */
export interface HomeHeaderModel {
  /** the steps above the current one, from the top down */
  path: Crumb[];
  /** the current step — none while the view's folder is not listed yet */
  current: string | null;
  /** the project the view's folder is in — its step carries the badge (#236 D4) */
  project: string | null;
  /** the current step's folder */
  currentId: string | null;
  /** the muted line after the path */
  caption: string | null;
  /** the folder the ⋯ and New ▾ act on, with its parent (none for a project) */
  actions: { folder: FolderMeta; parent: FolderMeta | null } | null;
  /** whether the Cards | Canvas switch ends the row — Recent has none */
  switch: boolean;
  /** the card size button, where cards fill the sheet: the Cards dashboard and folder view, Recent (#236 D5) */
  cardSize: boolean;
  /** the folder whose path card the current step offers — a folder view's, in either mode (#238 R3) */
  pathOf: string | null;
}

const crumbOf = (folder: FolderMeta): Crumb => ({ id: folder.id, name: folder.name });

/**
 * Home's header row for `view` in `mode` (#231 D2, D3), decided without
 * React — the nine rows of the slot table. Cards names the dashboard "Home"
 * and a folder by its path from the project down; Canvas names the board
 * "Library" and puts it in front of a folder's path. Recent is cards in
 * either mode, with no switch. A count needs a listing that could be read
 * (`failed`: it could not, and nothing was listed before).
 */
export const homeHeaderModel = (
  view: HomeView,
  mode: HomeMode,
  folders: FolderMeta[] | null,
  failed = false,
): HomeHeaderModel => {
  const listed = folders !== null && !failed ? folders : null;
  if (view.kind === "recent") {
    return {
      path: [],
      current: "Recent",
      project: null,
      currentId: null,
      caption: listed ? plural(allDiagrams(listed).length, "diagram") : null,
      actions: null,
      switch: false,
      // Recent is cards in either mode
      cardSize: true,
      pathOf: null,
    };
  }
  const canvas = mode === "canvas";
  if (view.kind === "dashboard") {
    return {
      path: [],
      current: canvas ? "Library" : "Home",
      project: null,
      currentId: null,
      // every project; every diagram at every depth (#229 D18)
      caption:
        canvas && listed
          ? `${plural(listed.length, "project")} · ${plural(allDiagrams(listed).length, "diagram")}`
          : null,
      actions: null,
      switch: true,
      // the RECENT row is a card grid (#236 D7)
      cardSize: !canvas,
      pathOf: null,
    };
  }
  const found = folders ? findFolder(folders, view.folder) : undefined;
  // not listed yet: no name to give, but the switch keeps its place
  if (!found) {
    return {
      path: [],
      current: null,
      project: null,
      currentId: null,
      caption: null,
      actions: null,
      switch: true,
      cardSize: false,
      pathOf: null,
    };
  }
  const { folder, path } = found;
  const pathOf = folder.id;
  const above = path.slice(0, -1);
  const place = { project: path[0]!.id, currentId: folder.id };
  if (canvas) {
    // the board says where the camera is; what a folder holds is on its frame
    return {
      path: [LIBRARY, ...above.map(crumbOf)],
      current: folder.name,
      ...place,
      caption: null,
      actions: null,
      switch: true,
      cardSize: false,
      pathOf,
    };
  }
  // a project not found holds nothing and takes nothing: its box says the rest (#253 R7)
  const missing = isMissing(folder);
  return {
    path: above.map(crumbOf),
    current: folder.name,
    ...place,
    caption: missing
      ? null
      : `${plural(itemCount(folder), "item")} · edited ${relativeTime(folder.updatedAt)}`,
    actions: missing ? null : { folder, parent: above.at(-1) ?? null },
    switch: true,
    cardSize: true,
    pathOf,
  };
};

/** a step of the path pressed: a folder's view, or the whole board */
const goTo = (id: string) =>
  viewInHome(id === LIBRARY_CRUMB ? DASHBOARD : { kind: "folder", folder: id }, true);

/**
 * Home's header row (#231 D2, `Main`, `Hybrid-*`): 44 high, the path and its
 * caption on the left, then a folder's ⋯ and New ▾ and a divider, the
 * card size button where cards fill the sheet (#236 D5, `Home-CardSize`), and
 * the Cards | Canvas switch last. Home draws it once, above whatever the view
 * and mode show, so the switch is never drawn anew and keeps its focus. Its
 * current step is the sheet's one h1 (#220 D16); ⋯ Rename edits the name in
 * that step's place (`Home-States` 4). A new folder is named on its card,
 * not here (#231 D8).
 */
export const HomeHeader = () => {
  const folders = useLibraryStore((s) => s.folders);
  const readFailed = useLibraryStore((s) => s.readFailed);
  const homeView = useAppStore((s) => s.homeView);
  const mode = useHomeMode((s) => s.mode);
  const model = homeHeaderModel(
    resolveHomeView(homeView, folders),
    mode,
    folders,
    readFailed && (folders?.length ?? 0) === 0,
  );
  const { actions } = model;
  const target = actions?.folder.id ?? null;
  const more = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLDivElement>(null);
  /** the folder whose name is being edited — the field goes with its view */
  const [renaming, setRenaming] = useState<string | null>(null);
  if (renaming !== null && renaming !== target) setRenaming(null);
  const editing = renaming !== null && renaming === target ? actions : null;
  /** the edit ended with Enter or Escape — not by leaving it — so ⋯ takes the focus back */
  const refocus = useRef(false);

  const isEditing = editing !== null;
  // the current step's path card — not while its name is being edited (#238 R3)
  const pathFolder =
    model.pathOf !== null && model.current !== null && !isEditing
      ? { id: model.pathOf, name: model.current }
      : null;
  const pathCard = usePathCard(pathFolder);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isEditing || !refocus.current) return;
    refocus.current = false;
    more.current?.focus();
  }, [isEditing]);

  const editor = editing ? (
    // 160 wide, 2 above and below: the row and the caption stay put
    <div ref={field} className="mx-px my-0.5 flex w-40">
      <NameInput
        name={editing.folder.name}
        label={editing.parent ? "Folder name" : "Project name"}
        size="sm"
        onDone={(name) => {
          refocus.current = field.current?.contains(document.activeElement) ?? false;
          setRenaming(null);
          if (name !== null) void renameFolderTo(editing.folder, name);
        }}
      />
    </div>
  ) : undefined;

  return (
    <header className="flex h-11 flex-none items-center gap-2.5 bg-surface pl-4 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {model.current !== null ? (
          <PathCrumbs
            path={model.path}
            current={model.current}
            currentId={model.currentId}
            project={model.project}
            onCrumb={goTo}
            heading
            editor={editor}
            onCurrentHover={pathFolder ? pathCard.onStep : undefined}
            currentActive={pathCard.card !== null}
          />
        ) : null}
        {model.caption ? (
          <p className="m-0 flex-none whitespace-nowrap text-[11px] leading-[14px] text-muted">
            {model.caption}
          </p>
        ) : null}
      </div>
      {actions && folders ? (
        // one per folder: a menu open for one folder is not another's
        <FolderActions
          key={actions.folder.id}
          folder={actions.folder}
          parent={actions.parent}
          folders={folders}
          more={more}
          onRename={() => setRenaming(actions.folder.id)}
        />
      ) : null}
      {model.cardSize ? <CardSizeButton /> : null}
      {model.switch ? <ViewSwitch /> : null}
      {pathCard.card ? (
        <PathCard
          card={pathCard.card}
          cardRef={cardRef}
          step={pathCard.step}
          onEnter={pathCard.stay}
          onLeave={pathCard.leave}
          onClose={pathCard.close}
        />
      ) : null}
    </header>
  );
};

/**
 * A folder's actions in the header row (#231 D2, D8, D9): ⋯ is the
 * folder's menu — the tree row's list (Move to… for a folder with somewhere
 * to go, never a project); New ▾ is the New menu, the dashed card's. Either's
 * New folder stays in this view and names the new folder on its card. Then
 * the 1×16 divider before the switch.
 */
const FolderActions = ({
  folder,
  parent,
  folders,
  more,
  onRename,
}: {
  folder: FolderMeta;
  parent: FolderMeta | null;
  folders: FolderMeta[];
  more: RefObject<HTMLButtonElement | null>;
  onRename: () => void;
}) => {
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  const [newAt, setNewAt] = useState<Point | null>(null);
  const create = useRef<HTMLButtonElement>(null);
  const items = folderMenuItems(folder, onRename, {
    // it is gone: the view it was in — its parent folder, or the dashboard
    // for a project — and that view's title takes focus (D16), only while
    // Home still shows it (#218 D15)
    onDeleted: (asked) =>
      focusHomeTitleIfStill(asked, parent ? { kind: "folder", folder: parent.id } : DASHBOARD),
    // none at the deepest level, where no folder can go (#229 D9)
    newFolder: canHoldFolders(folders, folder.id)
      ? () => newFolderFromHome(folder.id, { mayFocus: inSheet(more.current) })
      : undefined,
    // somewhere to go besides where it is (#230 D12)
    move:
      parent && canMoveFolder(folders, folder.id)
        ? folderMovePicker(folder, folders, parent.id, { expanded: unfoldedFolders() })
        : undefined,
  });

  return (
    <>
      <div
        role="toolbar"
        aria-label={parent ? "Folder actions" : "Project actions"}
        className="flex flex-none items-center gap-1.5"
      >
        <button
          ref={more}
          type="button"
          aria-label={`More for ${folder.name}`}
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(e) => setMenuAt(menuAt ? null : belowRightOf(e.currentTarget))}
          className={`flex h-7 w-7 items-center justify-center rounded-md text-icon transition-colors hover:bg-hover ${FOCUS_RING}`}
        >
          <Ellipsis size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          ref={create}
          type="button"
          aria-label={`New in ${folder.name}`}
          aria-haspopup="menu"
          aria-expanded={newAt !== null}
          onClick={(e) => setNewAt(newAt ? null : belowRightOf(e.currentTarget))}
          className={`h-7 gap-1.5 rounded-md pl-2.5 pr-2 ${INK_FILL}`}
        >
          <Plus size={15} strokeWidth={1.9} aria-hidden="true" />
          New
          <ChevronDown size={12} strokeWidth={2} aria-hidden="true" className="text-on-ink-muted" />
        </button>
      </div>
      {/* fixed, out of the row's flow — before the divider, so the switch stays last */}
      {menuAt ? (
        <Menu
          at={menuAt}
          label={`More for ${folder.name}`}
          items={items}
          opener={more}
          onSelect={(item) => {
            setMenuAt(null);
            if (!item.takesFocus) more.current?.focus();
            item.onSelect();
          }}
          onClose={(returnFocus) => {
            setMenuAt(null);
            if (returnFocus) more.current?.focus();
          }}
        />
      ) : null}
      {newAt ? (
        <NewMenu
          at={newAt}
          folder={folder}
          folders={folders}
          opener={create}
          onClose={() => setNewAt(null)}
        />
      ) : null}
      <span aria-hidden="true" className="mx-2 h-4 w-px flex-none bg-dot" />
    </>
  );
};
