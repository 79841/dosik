import { memo } from "react";

import { itemKey, type ProjectMeta } from "../../library/libraryApi";
import { openFromLibrary } from "../../library/navigation";
import { relativeTime } from "../../library/relativeTime";
import { DiagramThumbnail } from "../DiagramThumbnail";
import { BoardCardFrame } from "./BoardCardFrame";
import { cardKey } from "./boardNav";
import { metaLine, nameLine, useDeferPictures, wellSize } from "./boardParts";
import { useBoardStore } from "./boardStore";

/**
 * a diagram card's face: its picture in the well, or "No preview" for one
 * that could not be read — the stack's front face too (#221 D4, D6); a
 * tile's well is 300×188 (#231 D14)
 */
export const DiagramWell = ({
  diagram,
  tile = false,
}: {
  diagram: ProjectMeta | undefined;
  tile?: boolean;
}) => {
  const defer = useDeferPictures();
  return (
    <span className={`block ${wellSize(tile)} flex-none overflow-hidden rounded-[8px] bg-surface`}>
      {diagram?.readable ? (
        <DiagramThumbnail
          id={diagram.id}
          updatedAt={diagram.updatedAt}
          lazy="visible"
          defer={defer}
          labelClassName="text-[14px]"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[14px] text-muted">
          No preview
        </span>
      )}
    </span>
  );
};

/**
 * A diagram on the library board (#221 D4, D13, D17, D20): its picture,
 * title and edit, at its place in its frame (board units). A click only
 * picks it; a double click, Enter, Space or the Open pill opens it (#229
 * D18). Dragged onto another folder's frame it moves there (`useCardDrag`,
 * #231 D15). As a `tile` — in an open folder's sub-frame (#231 D14) — it is
 * the big card, the canvas's tile × 240/180, and its pill sits across the
 * well. The box, the drag and the keys are `BoardCardFrame`'s.
 */
export const BoardCard = memo(function BoardCard({
  diagram,
  folder,
  x,
  y,
  tile = false,
}: {
  diagram: ProjectMeta;
  /** the folder it is in */
  folder: string;
  x: number;
  y: number;
  /** in an open folder's sub-frame */
  tile?: boolean;
}) {
  const key = cardKey(diagram.id);
  const { title, readable } = diagram;
  const edited = relativeTime(diagram.updatedAt);
  return (
    <BoardCardFrame
      boardKey={key}
      item={itemKey("diagram", diagram.id)}
      from={folder}
      x={x}
      y={y}
      tile={tile}
      name={title}
      label={`${title}, ${readable ? "" : "unreadable, "}edited ${edited}`}
      onOpen={() => void openFromLibrary(diagram.id)}
      onMenu={(at) =>
        useBoardStore.getState().openMenu({ kind: "diagram", diagram: diagram.id, at, from: key })
      }
    >
      <DiagramWell diagram={diagram} tile={tile} />
      <span className={nameLine(tile)}>{title}</span>
      <span className={metaLine(tile)}>
        <span className="truncate">{`Edited ${edited}`}</span>
      </span>
    </BoardCardFrame>
  );
});
