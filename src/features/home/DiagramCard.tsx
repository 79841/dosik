import { useRef } from "react";

import { type FolderMeta, itemKey, type ProjectMeta } from "../library/libraryApi";
import { moveDiagram } from "../library/libraryActions";
import { diagramMenuItems } from "../library/libraryMenus";
import { canMoveDiagrams } from "../library/libraryTree";
import { diagramMovePicker } from "../library/MovePicker";
import { focusHomeTitleIfStill, openFromLibrary } from "../library/navigation";
import { relativeTime } from "../library/relativeTime";
import { stillOnScreen } from "../library/screenStamp";
import { unfoldedFolders } from "../sidebar/treeStore";
import { CardFrame, followMoveAway } from "./CardFrame";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { NoPreview } from "./homeParts";

/**
 * A diagram in its folder's view (#220 D11, #229 D5, #231 D7·D8): its
 * picture, title and edit. One press selects it, a double click — or Enter,
 * or Open — opens it in its tab; More is the diagram's menu, the tree row's.
 */
export const DiagramCard = ({
  diagram,
  folder,
  folders,
  selected,
  stop,
}: {
  diagram: ProjectMeta;
  /** the folder whose view it is in */
  folder: FolderMeta;
  folders: FolderMeta[];
  selected: boolean;
  stop: boolean;
}) => {
  const main = useRef<HTMLButtonElement>(null);
  const { title, readable } = diagram;
  const edited = relativeTime(diagram.updatedAt);
  const items = diagramMenuItems(
    diagram,
    canMoveDiagrams(folders)
      ? diagramMovePicker(diagram, folders, folder.id, {
          expanded: unfoldedFolders(),
          move: (target) =>
            followMoveAway(main.current, folder.id, () => moveDiagram(diagram, target)),
        })
      : null,
    {
      // the card is gone: its folder's title takes focus (D16) — while Home still shows it
      onDeleted: (asked) => focusHomeTitleIfStill(asked, { kind: "folder", folder: folder.id }),
      // no tab took the title edit (#219 D3): the focus comes back to the card —
      // while the screen and the focus have not gone on (#218 D15, #230)
      onRenameFailed: (asked) => {
        const card = main.current?.closest("li");
        if (stillOnScreen(asked, { where: [card] })) main.current?.focus();
      },
    },
  );
  return (
    <CardFrame
      card={itemKey("diagram", diagram.id)}
      folder={folder.id}
      name={title}
      label={`${title}, ${readable ? "diagram" : "unreadable"}, edited ${edited}`}
      selected={selected}
      stop={stop}
      main={main}
      well={
        // 15:8 — 168 at Medium's 336; the size picked changes its width, not its shape (#236 D5)
        <span className="block aspect-[15/8] w-full overflow-hidden rounded-[6px] bg-surface">
          {readable ? (
            <DiagramThumbnail id={diagram.id} updatedAt={diagram.updatedAt} lazy />
          ) : (
            <NoPreview />
          )}
        </span>
      }
      meta={`Edited ${edited}`}
      menuItems={items}
      onOpen={() => void openFromLibrary(diagram.id)}
    />
  );
};
