import { Maximize, Minus, Plus } from "lucide-react";

import { ICON_STROKE, IconButton, SMALL_ICON_SIZE } from "./IconButton";

const icon = { size: SMALL_ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true } as const;

/**
 * The zoom island at a canvas's bottom right (#219 D10, #221 D16): − · the
 * ratio · + │ Fit to screen. The editor's canvas and the Home library board
 * show the same one — this draws it, the caller says what each press does.
 * The ratio shows the zoom and puts it back to 100%; − and + go out at the
 * ends of the range; `disabled` turns the whole island off (a board with
 * nothing to show).
 *
 * One island for both: 36 tall, 12 in from the corner, 28 buttons, on the
 * edit bar's layer (z-30) so a bar raised onto the row above never covers
 * its tooltips, which open upward (#219). `data-*` attributes go
 * on the island — the Home board marks its islands so a card is never
 * dropped under one (#221).
 */
export const ZoomIsland = ({
  zoom,
  minZoom,
  maxZoom,
  onZoomOut,
  onReset,
  onZoomIn,
  onFit,
  disabled = false,
  ...data
}: {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onZoomOut: () => void;
  /** the ratio: back to 100% */
  onReset: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  disabled?: boolean;
} & { [attribute: `data-${string}`]: string | undefined }) => {
  const percent = Math.round(zoom * 100);
  return (
    // a fieldset: the group role, without a legend — the name is its label
    <fieldset
      {...data}
      aria-label="Zoom"
      // nodelete: Backspace on a focused button must not delete the canvas selection.
      // z-30: the edit bar's layer, so a raised bar never covers the tooltips
      className="nodelete absolute right-3 bottom-3 z-30 m-0 flex h-9 min-w-0 items-center gap-0.5 rounded-(--radius-island) border-0 bg-surface px-1 py-0 shadow-raised"
    >
      <IconButton
        label="Zoom out"
        size={28}
        tooltip="above"
        disabled={disabled || zoom <= minZoom}
        onClick={onZoomOut}
      >
        <Minus {...icon} />
      </IconButton>
      <button
        type="button"
        aria-label={`Zoom ${percent}%, reset to 100%`}
        title="Reset to 100%"
        disabled={disabled}
        onClick={onReset}
        className="h-7 min-w-11 rounded-(--radius-button) px-1 text-[11.5px] font-medium text-ink tabular-nums transition-colors hover:bg-hover disabled:opacity-35 disabled:hover:bg-transparent"
      >
        {percent}%
      </button>
      <IconButton
        label="Zoom in"
        size={28}
        tooltip="above"
        disabled={disabled || zoom >= maxZoom}
        onClick={onZoomIn}
      >
        <Plus {...icon} />
      </IconButton>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
      <IconButton
        label="Fit to screen"
        size={28}
        tooltip="above"
        align="end"
        disabled={disabled}
        onClick={onFit}
      >
        <Maximize {...icon} />
      </IconButton>
    </fieldset>
  );
};
