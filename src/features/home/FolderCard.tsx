import { useEffect, useRef, useState } from "react";

import { FolderGlyph } from "../../shared/ui/KindGlyph";
import { useAppStore } from "../library/appStore";
import { type FolderMeta, itemKey } from "../library/libraryApi";
import { moveFolderTo, plural, renameFolderTo } from "../library/libraryActions";
import { folderMenuItems } from "../library/libraryMenus";
import { NameInput } from "../library/libraryParts";
import { canHoldFolders, canMoveFolder, itemCount } from "../library/libraryTree";
import { folderMovePicker } from "../library/MovePicker";
import { focusHomeTitleIfStill, viewInHome } from "../library/navigation";
import { stillOnScreen } from "../library/screenStamp";
import { unfoldedFolders } from "../sidebar/treeStore";
import { CardFrame, followMoveAway } from "./CardFrame";
import { inSheet, newFolderFromHome } from "./NewMenu";

/**
 * A folder among a folder's cards on Home (#229 D5, #231 D8, card C of #265,
 * `Home-States`): a Folder in the well where a diagram has its picture, the
 * name and what it holds in the caption bar. One click, Enter or Open goes
 * into it and the new view's title takes focus (#220 D16). More
 * is the folder's menu, the tree row's; its Rename edits the name on the
 * card, and the focus comes back to the card after Enter or Escape. A folder
 * just made from Home edits its name on its card the same way (#231 D8): the
 * request waits in the app store for the card with its id. The menu's New
 * folder goes in this card's folder, so Home goes there to name it.
 */
export const FolderCard = ({
  folder,
  parent,
  folders,
  stop,
}: {
  folder: FolderMeta;
  /** the folder whose view it is in */
  parent: FolderMeta;
  folders: FolderMeta[];
  stop: boolean;
}) => {
  const main = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  /** the edit ended with Enter or Escape — not by leaving it — so the card takes the focus back */
  const refocus = useRef(false);
  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    main.current?.focus();
  }, [renaming]);

  // a folder just made from Home names itself on its card — the request is
  // taken once, and dropped if it was asked on another screen (#231 C1)
  const renameRequest = useAppStore((s) => s.folderRenameRequest);
  useEffect(() => {
    if (renameRequest?.id !== folder.id) return;
    useAppStore.getState().takeFolderRename();
    if (stillOnScreen(renameRequest.asked)) setRenaming(true);
  }, [renameRequest, folder.id]);

  const count = plural(itemCount(folder), "item");
  const items = folderMenuItems(folder, () => setRenaming(true), {
    // the card is gone: the view's title takes focus (D16) — while Home still shows it
    onDeleted: (asked) => focusHomeTitleIfStill(asked, { kind: "folder", folder: parent.id }),
    // somewhere to go besides where it is (#230 D12)
    move: canMoveFolder(folders, folder.id)
      ? folderMovePicker(folder, folders, parent.id, {
          expanded: unfoldedFolders(),
          move: (target) => followMoveAway(main.current, () => moveFolderTo(folder, target)),
        })
      : undefined,
    // none at the deepest level, where no folder can go (#229 D9); this
    // card's folder is not on screen, so Home goes in to name it there
    newFolder: canHoldFolders(folders, folder.id)
      ? () => newFolderFromHome(folder.id, { enter: true, mayFocus: inSheet(main.current) })
      : undefined,
  });

  return (
    <CardFrame
      card={itemKey("folder", folder.id)}
      name={folder.name}
      label={`${folder.name}, folder, ${count}`}
      glyph={<FolderGlyph />}
      stop={stop}
      main={main}
      well={
        <span
          data-folder-well=""
          // 15:8, as a diagram card's well (#236 D5), full bleed (#265)
          className="flex aspect-[15/8] w-full items-center justify-center bg-frame"
        >
          <FolderGlyph size={36} strokeWidth={1.5} />
        </span>
      }
      meta={count}
      editor={
        renaming ? (
          // in the caption bar between the glyph and the count: the card keeps its size (Home-States 3)
          <div ref={field} className="flex min-w-0 flex-auto">
            <NameInput
              name={folder.name}
              label="Folder name"
              size="sm"
              onDone={(name) => {
                refocus.current = field.current?.contains(document.activeElement) ?? false;
                setRenaming(false);
                if (name !== null) void renameFolderTo(folder, name);
              }}
            />
          </div>
        ) : undefined
      }
      menuItems={items}
      onOpen={() => viewInHome({ kind: "folder", folder: folder.id }, true)}
    />
  );
};
