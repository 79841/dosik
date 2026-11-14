import { memo, useEffect, useRef } from "react";

import { FolderGlyph } from "../../../shared/ui/KindGlyph";
import { useAppStore } from "../../library/appStore";
import { type FolderMeta, itemKey } from "../../library/libraryApi";
import { plural, renameFolderTo } from "../../library/libraryActions";
import { NameInput } from "../../library/libraryParts";
import { itemCount } from "../../library/libraryTree";
import { stillOnScreen } from "../../library/screenStamp";
import { useBoardApi } from "./boardApi";
import { BoardCardFrame } from "./BoardCardFrame";
import { folderKey } from "./boardNav";
import { focusFolder, metaLine, nameLine, wellSize } from "./boardParts";
import { useBoardStore } from "./boardStore";

/**
 * a folder card's face: the Folder in the well — the stack's front face too
 * (#231 D13); a tile's well is 300×188 and its Folder 42, the canvas's 26
 * against 32 (D14)
 */
export const FolderWell = ({ tile = false }: { tile?: boolean }) => (
  <span
    data-folder-well=""
    className={`flex ${wellSize(tile)} flex-none items-center justify-center rounded-[8px] bg-frame`}
  >
    <FolderGlyph size={tile ? 42 : 34} strokeWidth={1.6} />
  </span>
);

/**
 * A folder on the library board (#231 D13, `Hybrid-Home-Canvas`,
 * `Home-States` 5): the diagram card's box with a Folder in the well, the
 * name and what it holds, at its place in its frame (board units). A click
 * only picks it; a double click, Enter, Space or the Open pill opens it in
 * place — Home's view goes to it and the board draws it as a sub-frame in
 * its card's place, the focus going to its first item (#231 D14), a move
 * inside the board that sends no focus to a heading (#221 D2). Shift+F10,
 * the context-menu key or a right-click is the folder's menu; its Rename —
 * or a folder just made from the New menu, whose request waits in the app
 * store (#231 D8) — edits the name on the card. Dragged onto another
 * folder's frame it moves there (D15). As a `tile` — in an open folder's
 * sub-frame — it opens in place too (D14): the big card, its pill across
 * the well. The box, the drag and the keys are `BoardCardFrame`'s.
 */
export const BoardFolderCard = memo(function BoardFolderCard({
  folder,
  parent,
  x,
  y,
  tile = false,
}: {
  folder: FolderMeta;
  /** the folder it is in */
  parent: string;
  x: number;
  y: number;
  /** in an open folder's sub-frame */
  tile?: boolean;
}) {
  const api = useBoardApi();
  const key = folderKey(folder.id);
  const renaming = useBoardStore((s) => s.renaming === folder.id);
  const field = useRef<HTMLDivElement>(null);
  const count = plural(itemCount(folder), "item");

  // a folder just made from the New menu names itself on its card — the
  // request is taken once, and dropped if it was asked on another screen (#231 C1)
  const renameRequest = useAppStore((s) => s.folderRenameRequest);
  useEffect(() => {
    if (renameRequest?.id !== folder.id) return;
    useAppStore.getState().takeFolderRename();
    if (!stillOnScreen(renameRequest.asked)) return;
    const board = useBoardStore.getState();
    board.setRenaming(folder.id);
    board.setCurrent(key);
  }, [renameRequest, folder.id, key]);

  const editor = renaming ? (
    // the name line is the field — 4 under the well, the count 3 under it,
    // running into the card's bottom padding (Home-States 5): none of them
    // gives way, or the count would be cut at the card's bottom
    <div className="flex h-full w-full flex-col">
      <FolderWell tile={tile} />
      <div ref={field} className="mt-1 flex flex-none">
        <NameInput
          name={folder.name}
          label="Folder name"
          size="board"
          onDone={(name) => {
            // ended with Enter or Escape — not by leaving it — so the card takes the focus back
            const refocus = field.current?.contains(document.activeElement) ?? false;
            useBoardStore.getState().setRenaming(null);
            if (name !== null) void renameFolderTo(folder, name);
            if (refocus) api.focusItem(key);
          }}
        />
      </div>
      <span
        className={`mt-[3px] block flex-none truncate px-1 text-muted ${tile ? "text-[15px] leading-5" : "text-[14px] leading-[18px]"}`}
      >
        {count}
      </span>
    </div>
  ) : undefined;

  return (
    <BoardCardFrame
      boardKey={key}
      item={itemKey("folder", folder.id)}
      from={parent}
      x={x}
      y={y}
      tile={tile}
      name={folder.name}
      label={`${folder.name}, folder, ${count}`}
      editor={editor}
      onOpen={() => focusFolder(folder.id)}
      onMenu={(at) =>
        useBoardStore.getState().openMenu({ kind: "folder", folder: folder.id, at, from: key })
      }
    >
      <FolderWell tile={tile} />
      <span className={nameLine(tile)}>{folder.name}</span>
      <span className={metaLine(tile)}>
        <span className="truncate">{count}</span>
      </span>
    </BoardCardFrame>
  );
});
