import { useRef } from "react";

import { DiagramGlyph } from "../../shared/ui/KindGlyph";
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
 * A diagram in its folder's view (#220 D11, #229 D5, #231 D8, card C of
 * #265): its picture, and its title and edit in the caption bar. One click —
 * or Enter, or Open — opens it in its tab; More is the diagram's menu, the
 * tree row's.
 */
export const DiagramCard = ({
  diagram,
  folder,
  folders,
  stop,
}: {
  diagram: ProjectMeta;
  /** the folder whose view it is in */
  folder: FolderMeta;
  folders: FolderMeta[];
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
          move: (target) => followMoveAway(main.current, () => moveDiagram(diagram, target)),
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
      name={title}
      label={`${title}, ${readable ? "diagram" : "unreadable"}, edited ${edited}`}
      glyph={<DiagramGlyph />}
      stop={stop}
      main={main}
      well={
        // 15:8 — the size picked changes its width, not its shape (#236 D5); full bleed (#265)
        <span className="block aspect-[15/8] w-full overflow-hidden bg-surface">
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
