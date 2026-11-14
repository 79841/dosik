import { ChevronsDownUp, ChevronsUpDown, FolderPlus } from "lucide-react";

import { Menu, type MenuItem } from "../../../shared/ui/Menu";
import { type FolderMeta, itemKey } from "../../library/libraryApi";
import { diagramMenuItems, folderMenuItems } from "../../library/libraryMenus";
import {
  canHoldFolders,
  canMoveDiagrams,
  canMoveFolder,
  findDiagram,
  findFolder,
  isInside,
} from "../../library/libraryTree";
import { diagramMovePicker, folderMovePicker } from "../../library/MovePicker";
import { unfoldedFolders } from "../../sidebar/treeStore";
import { type ScreenStamp, stillOnScreen } from "../../library/screenStamp";
import { NewMenu, newFolderFromHome } from "../NewMenu";
import { moveCardInto, newProjectAt, setCollapsed } from "./boardActions";
import { useBoardApi } from "./boardApi";
import { frameFold } from "./boardGeometry";
import type { BoardLayout } from "./boardLayout";
import { cardKey, folderKey, type NavItem, navItems, neighbourOf } from "./boardNav";
import { useBoardStore } from "./boardStore";

/**
 * The board's one open menu (#221 D15), drawn at the board's root — a
 * `fixed` menu inside the transformed layer would land in the wrong place
 * (#206). The empty board's (New project); a project's — the folder's menu,
 * the tree row's, with Expand or Collapse (#231 D13); a folder card's and a
 * diagram card's, with the Move to… picker beside them (#229 D13, #230
 * D12); a frame's + — the New menu (#231 D9).
 */
export const BoardMenus = ({
  folders,
  layout,
}: {
  folders: FolderMeta[];
  layout: BoardLayout | null;
}) => {
  const api = useBoardApi();
  const menu = useBoardStore((s) => s.menu);
  if (!menu) return null;
  const board = useBoardStore.getState();
  const from = "from" in menu ? menu.from : null;
  const close = (returnFocus: boolean) => {
    board.closeMenu();
    if (returnFocus && from) api.focusItem(from);
  };
  const pick = (item: MenuItem) => {
    board.closeMenu();
    if (!item.takesFocus && from) api.focusItem(from);
    item.onSelect();
  };
  /** after a delete went through: focus on what stays next to it, not on the page (#221) */
  const toNeighbour = (gone: (item: NavItem) => boolean) => (asked: ScreenStamp) => {
    // the delete has ended later: not if the user has gone on — another tab,
    // the focus somewhere else (#218 D15, #229). Home's view
    // may be the delete's own doing (a focused card it took away)
    if (!stillOnScreen(asked, { homeView: null }) || !api.holdsFocus()) return;
    const next = from && layout ? neighbourOf(navItems(layout), from, gone) : null;
    if (next) api.focusItem(next);
  };

  switch (menu.kind) {
    case "canvas":
      return (
        <Menu
          at={menu.at}
          label="Canvas"
          items={[
            {
              label: "New project",
              icon: FolderPlus,
              takesFocus: true,
              onSelect: () => void newProjectAt(menu.board, api.holdsFocus),
            },
          ]}
          onSelect={pick}
          onClose={close}
        />
      );
    case "project": {
      const folder = folders.find((f) => f.id === menu.folder);
      if (!folder) return null;
      // as the frame is drawn (#231 D13): no item that would change nothing on screen
      const frame = layout?.byId.get(folder.id);
      const shown = frame ? frameFold(frame.folder, frame.layout) : null;
      const fold: MenuItem[] =
        shown === null
          ? []
          : [
              {
                label: shown === "expand" ? "Expand" : "Collapse",
                icon: shown === "expand" ? ChevronsUpDown : ChevronsDownUp,
                onSelect: () => void setCollapsed(folder.id, shown === "collapse"),
              },
            ];
      return (
        <Menu
          at={menu.at}
          label={`More for ${folder.name}`}
          items={folderMenuItems(folder, () => board.setRenaming(folder.id), {
            afterRename: fold,
            // its new card in this frame names itself (#231 D8)
            newFolder: canHoldFolders(folders, folder.id)
              ? () => newFolderFromHome(folder.id, { mayFocus: api.holdsFocus })
              : undefined,
            onDeleted: toNeighbour((item) => item.frame === folder.id),
          })}
          opener={menu.opener}
          onSelect={pick}
          onClose={close}
        />
      );
    }
    case "folder": {
      const found = findFolder(folders, menu.folder);
      const parent = found?.path.at(-2);
      if (!found || !parent) return null;
      const { folder } = found;
      return (
        <Menu
          at={menu.at}
          label={`More for ${folder.name}`}
          items={folderMenuItems(folder, () => board.setRenaming(folder.id), {
            // somewhere to go besides where it is (#230 D12); the receiving frame keeps its place
            move: canMoveFolder(folders, folder.id)
              ? folderMovePicker(folder, folders, parent.id, {
                  expanded: unfoldedFolders(),
                  move: (target) => void moveCardInto(itemKey("folder", folder.id), target),
                })
              : undefined,
            // made inside this folder: Home goes into it — the board's own move,
            // no heading takes the focus (#221 D2) — and its new card names it
            newFolder: canHoldFolders(folders, folder.id)
              ? () =>
                  newFolderFromHome(folder.id, {
                    enter: true,
                    focusHeading: false,
                    mayFocus: api.holdsFocus,
                  })
              : undefined,
            // its card, and whatever of it the board draws
            onDeleted: toNeighbour(
              (item) =>
                item.key === folderKey(folder.id) ||
                (item.id !== undefined && isInside(folders, item.id, folder.id)),
            ),
          })}
          onSelect={pick}
          onClose={close}
        />
      );
    }
    case "diagram": {
      const found = findDiagram(folders, menu.diagram);
      if (!found) return null;
      const movable = canMoveDiagrams(folders);
      // the card shows the move at once (#221 D13), into a folder at any depth
      const move = diagramMovePicker(found.diagram, folders, found.folder.id, {
        expanded: unfoldedFolders(),
        move: (target) => void moveCardInto(itemKey("diagram", found.diagram.id), target),
      });
      return (
        <Menu
          at={menu.at}
          label={`More for ${found.diagram.title}`}
          items={diagramMenuItems(found.diagram, movable ? move : null, {
            // its card — a stack stays, with another in front
            onDeleted: toNeighbour((item) => item.key === cardKey(found.diagram.id)),
            // the diagram could not be opened to edit its title: back to the card —
            // while the board is still where the user is (#218 D15, #230)
            onRenameFailed: (asked) => {
              if (stillOnScreen(asked, { homeView: null }) && api.holdsFocus()) {
                api.focusItem(menu.from);
              }
            },
          })}
          onSelect={pick}
          onClose={close}
        />
      );
    }
    case "new": {
      const found = findFolder(folders, menu.folder);
      if (!found) return null;
      // the New menu opens and closes on its own button, which takes the focus back
      return (
        <NewMenu
          at={menu.at}
          folder={found.folder}
          folders={folders}
          opener={menu.opener}
          // New folder names its card only while the focus is on the board or nowhere (#231 W1)
          mayFocus={api.holdsFocus}
          onClose={() => board.closeMenu()}
        />
      );
    }
  }
};
