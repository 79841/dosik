import { MousePointerClick } from "lucide-react";

import { ZoomIsland } from "../../../shared/ui/ZoomIsland";
import { boardBounds, type BoardLayout } from "./boardLayout";
import { useBoardStore } from "./boardStore";
import {
  DEFAULT_ZOOM,
  FIT_TOP,
  fitRect,
  MAX_ZOOM,
  MIN_ZOOM,
  type Size,
  stepZoom,
  type Viewport,
  zoomAt,
} from "./boardViewport";

/**
 * An island's look (D16): 12 in, radius 10, lifted, above the board. Two
 * are left — the hint pill and the zoom island at the bottom; "Library",
 * the path and the switch are Home's header row (#231 D12).
 */
const ISLAND = "absolute z-10 rounded-(--radius-island) bg-surface shadow-raised";

/** after the Esc key: what the hint says in a focus (#231 D12) */
const FOCUS_HINT = "to zoom out · Double-click a diagram to open it in a tab";

/** what the hint says (D16, #231 D12) — the board's description too */
export const hintText = (focus: boolean): string =>
  focus
    ? `Esc ${FOCUS_HINT}`
    : "Double-click a folder to open it in place · Drag a card onto another frame to move it";

/**
 * Bottom left (D16): what the board's hands do. It never reaches under the
 * zoom island — too long, it ends in an ellipsis and says it whole on hover.
 * In 0 12 0 10 when it leads with the icon (`Hybrid-Home-Canvas`), 0 12 0 6
 * when it leads with the Esc key (`Hybrid-Folder-Canvas`, #231 D12).
 */
export const HintPill = ({ id, focus }: { id: string; focus: boolean }) => (
  <p
    id={id}
    data-board-island=""
    title={hintText(focus)}
    className={`${ISLAND} bottom-3 left-3 m-0 flex h-7 max-w-[calc(100%-24px-172px)] items-center gap-1.5 rounded-full pr-3 text-[11.5px] font-medium text-muted ${
      focus ? "pl-1.5" : "pl-2.5"
    }`}
  >
    {focus ? (
      <>
        <kbd className="flex h-[18px] flex-none items-center rounded-[4px] bg-hover px-[5px] font-[inherit] text-[10.5px] font-semibold text-icon">
          Esc
        </kbd>{" "}
        {/* the space is for the description; the flex gap draws it */}
        <span className="truncate">{FOCUS_HINT}</span>
      </>
    ) : (
      <>
        <MousePointerClick size={14} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
        <span className="truncate">{hintText(false)}</span>
      </>
    )}
  </p>
);

const RESTING: Viewport = { x: 0, y: 0, zoom: DEFAULT_ZOOM };

/** Bottom right (D10, D16): the shared zoom island on the board's camera */
export const BoardZoom = ({
  size,
  layout,
  disabled,
}: {
  size: Size;
  layout: BoardLayout | null;
  disabled: boolean;
}) => {
  const zoom = useBoardStore((s) => s.viewport?.zoom ?? DEFAULT_ZOOM);
  const move = (next: (now: Viewport) => Viewport) => {
    const board = useBoardStore.getState();
    board.setViewport(next(board.viewport ?? RESTING), true);
  };
  return (
    <ZoomIsland
      // an island: a card let go over it lands nowhere (overIsland)
      data-board-island=""
      zoom={zoom}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      disabled={disabled}
      onZoomOut={() => move((now) => stepZoom(now, size, -1))}
      onZoomIn={() => move((now) => stepZoom(now, size, 1))}
      onReset={() => move((now) => zoomAt(now, { x: size.width / 2, y: size.height / 2 }, 1))}
      onFit={() => {
        const bounds = layout ? boardBounds(layout.frames) : null;
        if (!bounds) return;
        // the whole board, hung where its first view hangs it (#231 D12)
        move(() => fitRect(bounds, size, { min: MIN_ZOOM, max: 1, top: FIT_TOP.board }));
      }}
    />
  );
};
