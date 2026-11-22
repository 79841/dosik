import {
  Copy,
  FolderInput,
  FolderMinus,
  FolderPlus,
  FolderSearch,
  Locate,
  Pencil,
  SquareArrowOutUpRight,
  SquarePlus,
  Trash2,
} from "lucide-react";

import type { MenuItem } from "../../shared/ui/Menu";
import { showInLabel } from "./fileManager";
import type { FolderMeta, ItemKind, ProjectMeta } from "./libraryApi";
import {
  copyItemPath,
  deleteDiagramAsking,
  deleteFolderAsking,
  locateProjectAsking,
  removeFromLibrary,
  showItemInFinder,
} from "./libraryActions";
import { isMissing } from "./libraryTree";
import { newDiagram, openFromLibrary, renameDiagram } from "./navigation";
import { type ScreenStamp, screenStamp } from "./screenStamp";

/**
 * The menus a folder and a diagram carry (#217 D10) — one list each, for the
 * tree's row `…` and for Home's folder header and cards (#220 D11), so the
 * places cannot drift apart. Renaming, a new folder and moving happen where
 * the menu was opened, so the caller says how. Rules split the groups as the
 * canvas draws them (note `sidebarMenus`).
 */

/**
 * Show in Finder · Copy Path (#238 R2), a group of their own before Rename: a
 * folder opens in the file manager, a diagram's file is shown selected there;
 * Copy Path puts the item's real path on the clipboard. "Show in …" names the
 * OS's file manager (`showInLabel`, D10).
 */
const finderItems = (kind: ItemKind, id: string): MenuItem[] => [
  {
    label: showInLabel(),
    icon: FolderSearch,
    separatorBefore: true,
    onSelect: () => void showItemInFinder(kind, id),
  },
  { label: "Copy Path", icon: Copy, onSelect: () => void copyItemPath(kind, id) },
];

/** Move to…, which opens its picker beside the menu (#229 D13) — a diagram's and a folder's */
const moveItem = (picker: NonNullable<MenuItem["picker"]>): MenuItem => ({
  label: "Move to…",
  icon: FolderInput,
  takesFocus: true,
  picker,
  onSelect: () => {},
});

/**
 * Remove from Library (#253 D9, D15, `Sidebar-Library` ②③): the project
 * leaves the list and its folder stays where it is — no danger tint, it
 * deletes nothing. `onRemoved` follows a removal that went through, with the
 * screen it was asked from.
 */
const removeItem = (folder: FolderMeta, onRemoved?: (asked: ScreenStamp) => void): MenuItem => ({
  label: "Remove from Library",
  icon: FolderMinus,
  separatorBefore: true,
  onSelect: () => {
    const asked = screenStamp();
    void removeFromLibrary(folder).then((removed) => {
      if (removed) onRemoved?.(asked);
    });
  },
});

/**
 * New diagram · New folder · — · Show in Finder · Copy Path · — · Rename ·
 * Move to… · — · Delete (#229 D11, #230 D11, #238 R2), for a project or a folder at any depth.
 * New folder is there when
 * `newFolder` says what it does (the tree names the row in place, Home and
 * the library canvas the new folder's card — #231 D8, D13); none for a
 * folder at the deepest level. Move to… is there when `move` opens its
 * picker — a folder that has somewhere to go (#230 D12; never a project).
 * `afterRename` goes after Rename (the canvas's Expand / Collapse, #221
 * D15); `onDeleted` follows a delete — or a removal — that went through.
 *
 * A project added from elsewhere ends in Remove from Library in place of
 * Delete; one not found has Locate… · — · Remove from Library alone (#253
 * R7, R8).
 */
export const folderMenuItems = (
  folder: FolderMeta,
  rename: () => void,
  {
    onDeleted,
    newFolder,
    move,
    afterRename = [],
  }: {
    onDeleted?: (asked: ScreenStamp) => void;
    newFolder?: () => void;
    move?: MenuItem["picker"];
    afterRename?: MenuItem[];
  } = {},
): MenuItem[] =>
  isMissing(folder)
    ? [
        {
          label: "Locate…",
          icon: Locate,
          onSelect: () => void locateProjectAsking(folder),
        },
        removeItem(folder, onDeleted),
      ]
    : [
        { label: "New diagram", icon: SquarePlus, onSelect: () => void newDiagram(folder.id) },
        ...(newFolder
          ? [{ label: "New folder", icon: FolderPlus, takesFocus: true, onSelect: newFolder }]
          : []),
        ...finderItems("folder", folder.id),
        {
          label: "Rename",
          icon: Pencil,
          takesFocus: true,
          separatorBefore: true,
          onSelect: rename,
        },
        ...(move ? [moveItem(move)] : []),
        ...afterRename,
        folder.added
          ? removeItem(folder, onDeleted)
          : {
              label: "Delete",
              icon: Trash2,
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                // the screen it was asked from: what follows the delete checks it (#218 D15)
                const asked = screenStamp();
                void deleteFolderAsking(folder).then((deleted) => {
                  if (deleted) onDeleted?.(asked);
                });
              },
            },
      ];

/**
 * Open · — · Show in Finder · Copy Path · — · Rename · Move to… · — · Delete
 * (#219 D3 added Rename, #238 R2 the Finder group) — Move only
 * where `move` is given (another folder to move to): the picker it opens
 * beside the menu (#229 D13, `MovePicker`).
 * Rename opens it and edits the title in its tab, which takes the focus;
 * `onRenameFailed` follows when it could not be opened, with the screen it
 * was asked from, so the caller can take the focus back — while that screen
 * is still up (#218 D15). `onDeleted` follows a delete that went through.
 */
export const diagramMenuItems = (
  diagram: ProjectMeta,
  move: MenuItem["picker"] | null,
  {
    onDeleted,
    onRenameFailed,
  }: {
    onDeleted?: (asked: ScreenStamp) => void;
    onRenameFailed?: (asked: ScreenStamp) => void;
  } = {},
): MenuItem[] => [
  { label: "Open", icon: SquareArrowOutUpRight, onSelect: () => void openFromLibrary(diagram.id) },
  ...finderItems("diagram", diagram.id),
  {
    label: "Rename",
    icon: Pencil,
    takesFocus: true,
    separatorBefore: true,
    onSelect: () => {
      const asked = screenStamp();
      void renameDiagram(diagram.id).then((editing) => {
        if (!editing) onRenameFailed?.(asked);
      });
    },
  },
  ...(move ? [moveItem(move)] : []),
  {
    label: "Delete",
    icon: Trash2,
    danger: true,
    separatorBefore: true,
    onSelect: () => {
      const asked = screenStamp();
      void deleteDiagramAsking(diagram).then((deleted) => {
        if (deleted) onDeleted?.(asked);
      });
    },
  },
];
