import { usePointerDrag } from "../../../shared/lib/pointerDrag";
import type { ItemKey } from "../../library/libraryApi";
import { moveCardInto } from "./boardActions";
import { useBoardApi } from "./boardApi";
import { dropTarget } from "./boardLayout";
import { followCamera } from "./boardParts";
import { type BoardDrag, useBoardStore } from "./boardStore";

/**
 * A card dragged across the board (#221 D13, #231 D15) — a diagram's or a
 * folder's, `item`, now in folder `from`. Past 4px it follows the pointer,
 * and the frame it would land in — the innermost under the pointer, an open
 * folder's sub-frame maybe (#231 D14) — shows as the drop target; let go there —
 * not over an island — it moves (`moveCardInto`); anywhere else it goes
 * back. Returns the drag while it is this card's, and the card's
 * `onPointerDown`.
 */
export const useCardDrag = (
  item: ItemKey,
  from: string,
): {
  drag: Extract<BoardDrag, { kind: "card" }> | null;
  onPointerDown: (e: React.PointerEvent) => void;
} => {
  const api = useBoardApi();
  const drag = useBoardStore((s) =>
    s.drag?.kind === "card" && s.drag.item === item ? s.drag : null,
  );
  const startDrag = usePointerDrag();

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = api.toBoard({ x: e.clientX, y: e.clientY });
    /** where the card would land: the folder of the frame under it, not under an island */
    const landing = (client: { x: number; y: number }) => {
      const at = api.toBoard(client);
      return {
        at,
        target: api.overIsland(client) ? null : dropTarget(api.layout(), item, from, at),
      };
    };
    const board = useBoardStore.getState();
    let pointer = { x: e.clientX, y: e.clientY };
    const follow = (client: { x: number; y: number }) => {
      pointer = client;
      const { at, target } = landing(client);
      board.setDrag({
        kind: "card",
        item,
        from,
        dx: at.x - start.x,
        dy: at.y - start.y,
        target,
      });
    };
    let unfollow = () => {};
    // dropped with the card: a listing, a delete or a view switch may take it off mid-drag
    startDrag(e, (client) => client, {
      // the board moving under a still pointer moves the card with it
      onStart: () => {
        unfollow = followCamera(() => follow(pointer));
      },
      onMove: follow,
      onEnd: (client) => {
        unfollow();
        const { target } = landing(client);
        board.setDrag(null);
        if (target) void moveCardInto(item, target);
      },
      onCancel: () => {
        unfollow();
        board.setDrag(null);
      },
    });
  };

  return { drag, onPointerDown };
};
