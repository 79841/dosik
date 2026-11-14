import { createContext, useContext } from "react";

import type { BoardLayout } from "./boardLayout";

type Point = { x: number; y: number };

/**
 * What the board's parts ask the board (#221): where a client point is on
 * the board, the layout as drawn, whether a point is over an island, and
 * moving focus. The functions read refs, so the value never changes and the
 * frames never draw again because of it.
 */
export interface BoardApi {
  /** a client point in board units, by the camera as it is now */
  toBoard: (client: Point) => Point;
  /** the layout on screen now — a drop is judged against it */
  layout: () => BoardLayout;
  /** whether a client point is over one of the floating islands — nothing lands there */
  overIsland: (client: Point) => boolean;
  /** puts focus on an item by its key and makes it the Tab stop */
  focusItem: (key: string) => void;
  /**
   * whether a slow action may still place the focus: it is on the board or
   * nowhere — not in something the user went to meanwhile (#218 D15)
   */
  holdsFocus: () => boolean;
  /**
   * one level out (#231 D14): `folder` closed — Collapse on its sub-frame —
   * or, without one, the folder in view (Esc): back to the folder it is in,
   * focus on its card; out of a project, the board as it was before the
   * focus, focus on the project's name
   */
  leave: (folder?: string) => void;
}

export const BoardApiContext = createContext<BoardApi | null>(null);

export const useBoardApi = (): BoardApi => {
  const api = useContext(BoardApiContext);
  if (!api) throw new Error("a board part outside the board");
  return api;
};
