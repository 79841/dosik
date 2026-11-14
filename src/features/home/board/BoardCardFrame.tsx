import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { FOCUS_RING } from "../../../shared/lib/palette";
import { besidePointer } from "../../../shared/ui/Menu";
import type { ItemKey } from "../../library/libraryApi";
import { belowOf, cardBox, isMenuKey, OPEN_PILL, TILE_OPEN_PILL } from "./boardParts";
import { useBoardStore } from "./boardStore";
import { useCardDrag } from "./useCardDrag";

type Point = { x: number; y: number };

/**
 * What a diagram's card and a folder's share on the library board (#221 D4,
 * D13, D17, D20, #231 D13–D15): the box at its place in its frame (board
 * units); a drag that moves its item onto another folder's frame
 * (`useCardDrag`); a right-click for its menu; and the main button, one of
 * the board's stops. A click only picks it; a double click, Enter, Space or
 * the Open pill opens it (#229 D18); Shift+F10 or the context-menu key is
 * its menu, under it. A name being edited (`editor`) takes the button's
 * place — no drag, no menu, no pill, no lift and no double-click open
 * meanwhile (`Home-States` 5). As a `tile` — in an open
 * folder's sub-frame (#231 D14) — it is the big card, its pill across the
 * well.
 */
export const BoardCardFrame = ({
  boardKey,
  item,
  from,
  x,
  y,
  tile,
  name,
  label,
  editor,
  onOpen,
  onMenu,
  children,
}: {
  /** its stop on the board (`cardKey`, `folderKey`) */
  boardKey: string;
  /** what a drag moves */
  item: ItemKey;
  /** the folder it is in */
  from: string;
  x: number;
  y: number;
  /** in an open folder's sub-frame */
  tile: boolean;
  /** what the Open pill names */
  name: string;
  /** the main button's accessible name */
  label: string;
  /** a name being edited, in the main button's place */
  editor?: ReactNode;
  onOpen: () => void;
  /** its menu, at a client point */
  onMenu: (at: Point) => void;
  /** the main button's face: the well, the name line, the meta line */
  children: ReactNode;
}) => {
  const stop = useBoardStore((s) => s.current === boardKey);
  const { drag, onPointerDown } = useCardDrag(item, from);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    } else if (isMenuKey(e)) {
      e.preventDefault();
      onMenu(belowOf(e.currentTarget));
    }
  };

  return (
    // the press is the card's (a drag); its keyboard is the button inside
    <div
      data-board-item=""
      onPointerDown={editor ? undefined : onPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!editor) onMenu(besidePointer({ x: e.clientX, y: e.clientY }));
      }}
      style={{
        left: x,
        top: y,
        transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
      }}
      className={cardBox(drag !== null, tile, editor !== undefined)}
    >
      {editor ?? (
        <button
          type="button"
          data-board-key={boardKey}
          tabIndex={stop ? 0 : -1}
          aria-label={label}
          onFocus={() => useBoardStore.getState().setCurrent(boardKey)}
          onClick={(e) => {
            // Enter and Space are the keydown's; a click from the keyboard has no count
            if (e.detail !== 0) e.currentTarget.focus({ preventScroll: true });
          }}
          onDoubleClick={onOpen}
          onKeyDown={onKeyDown}
          className={`flex h-full w-full flex-col rounded-[8px] text-left ${FOCUS_RING}`}
        >
          {children}
        </button>
      )}
      {editor ? null : (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Open ${name}`}
          // a double click opens once — its second click may land on what opened (Cards' rule)
          onClick={(e) => {
            if (e.detail <= 1) onOpen();
          }}
          className={tile ? TILE_OPEN_PILL : OPEN_PILL}
        >
          <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
          Open
        </button>
      )}
    </div>
  );
};
