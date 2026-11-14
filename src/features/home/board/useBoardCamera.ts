import { useLayoutEffect, useRef } from "react";

import type { HomeView } from "../../library/homeView";
import { findFolder } from "../../library/libraryTree";
import { boardBounds, type BoardLayout, openFrames } from "./boardLayout";
import { useBoardStore } from "./boardStore";
import {
  FIT_TOP,
  FOCUS_PAD,
  fitRect,
  focusViewport,
  initialViewport,
  type Size,
} from "./boardViewport";

/**
 * where the camera goes for a view: a folder's whole chain from its project
 * down (#231 D14) — moved to another project or folder
 * while it is open, the view stays the same but its frame is elsewhere, so
 * the camera goes again
 */
const cameraKey = (view: HomeView, layout: BoardLayout): string => {
  if (view.kind !== "folder") return "board";
  const path = findFolder(
    layout.frames.map((f) => f.folder),
    view.folder,
  )?.path;
  return `folder:${path ? path.map((f) => f.id).join("/") : view.folder}`;
};

/**
 * The board's camera follows Home's view (#221 D10–D12, #231 D14): the
 * first time the board is drawn in a run of the app it starts at 70%; a
 * project fits its frame (30–100%), hung 48 below the board's top like the
 * canvas's (#231 D12); a folder below a project, opened in place, brings
 * its sub-frame — the innermost — into view (50–100%, still if it is all in
 * view already), and again when it moves elsewhere while open; back on the
 * whole board it returns to where it was before the first focus. No view is
 * a diagram's (#231 D1).
 */
export const useBoardCamera = (view: HomeView, layout: BoardLayout | null, size: Size): void => {
  const applied = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!layout || size.width <= 0 || size.height <= 0) return;
    const board = useBoardStore.getState();
    board.ensureViewport(() => initialViewport(boardBounds(layout.frames), size));
    const key = cameraKey(view, layout);
    if (key === applied.current) return;
    applied.current = key;
    if (view.kind !== "folder") {
      if (board.beforeFocus) board.unfocusCamera();
      return;
    }
    const frame = layout.byId.get(view.folder);
    if (frame) {
      board.focusCamera(
        fitRect(frame, size, { min: 0.3, max: 1, pad: FOCUS_PAD, top: FIT_TOP.focus }),
      );
      return;
    }
    const rect = openFrames(layout).find((o) => o.id === view.folder);
    const now = useBoardStore.getState().viewport;
    // the project frame it is opened in hangs 48 down, as the canvas draws it (#231 D14)
    const project = rect ? layout.byId.get(rect.project) : undefined;
    if (rect && now) {
      board.focusCamera(focusViewport(now, rect, size, { min: 0.5, max: 1 }, project));
    }
  }, [view, layout, size]);
};
