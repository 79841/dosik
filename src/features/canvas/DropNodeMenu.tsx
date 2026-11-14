import { useRef } from "react";

import {
  isBackdrop,
  SHAPE_KINDS,
  SHAPE_LABELS,
  TEXT_MUTED,
  THUMBNAIL_PAINT,
} from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import type { ShapeKind } from "../../shared/lib/types";
import { usePopupPosition } from "../../shared/lib/usePopupPosition";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { useCanvasUiStore } from "./canvasUiStore";
import { ShapeSvg } from "./ShapeNode";

/**
 * Appears when a connection drag is dropped on empty canvas:
 * pick a shape to create-and-connect, or keep just the arrow.
 */
export const DropNodeMenu = () => {
  const menu = useCanvasUiStore((s) => s.dropMenu);
  const setDropMenu = useCanvasUiStore((s) => s.setDropMenu);
  const ref = useRef<HTMLDivElement>(null);
  const position = usePopupPosition(ref, menu && { x: menu.clientX, y: menu.clientY });

  useOutsideDismiss(ref, menu !== null, () => setDropMenu(null));

  if (!menu) return null;

  const pick = (shape: ShapeKind | "arrow-only"): void => {
    useDiagramStore
      .getState()
      .connectToNew(menu.fromId, menu.fromHandle, { x: menu.flowX, y: menu.flowY }, shape);
    setDropMenu(null);
  };

  return (
    <div
      ref={ref}
      // nodelete: Backspace on a focused shape must not delete the selection (#219)
      className="nodelete fixed z-50 w-56 rounded-lg bg-surface p-2 shadow-popover ring-1 ring-line"
      style={position}
    >
      <p
        className={`px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide ${TEXT_MUTED}`}
      >
        Connect to…
      </p>
      <div className="grid grid-cols-5 gap-1">
        {/* lifeline excluded: messages target existing lifelines, not new ones */}
        {/* icon excluded too: it needs a glyph picker, which lives in the palette */}
        {SHAPE_KINDS.filter(
          (s) =>
            s !== "text" && s !== "lifeline" && !isBackdrop(s) && s !== "icon" && s !== "image",
        ).map((shape) => (
          <button
            key={shape}
            type="button"
            title={SHAPE_LABELS[shape]}
            onClick={() => pick(shape)}
            className="flex h-9 items-center justify-center rounded-md hover:bg-hover"
          >
            <svg width={30} height={20} className="overflow-visible">
              <ShapeSvg shape={shape} width={30} height={20} {...THUMBNAIL_PAINT} />
            </svg>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => pick("arrow-only")}
        className="mt-1.5 w-full rounded-md bg-frame px-3 py-1.5 text-[12px] font-medium text-muted-strong hover:bg-selected"
      >
        Arrow only (no node)
      </button>
    </div>
  );
};
