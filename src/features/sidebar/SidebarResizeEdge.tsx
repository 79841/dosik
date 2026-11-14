import { useEffect, useRef, useState } from "react";

import {
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  useSidebarStore,
  useViewportWidth,
  visibleSidebarWidth,
} from "../../shared/lib/sidebarLayout";

/** the tooltip waits this long, so crossing the edge on the way somewhere shows nothing (D28) */
const TOOLTIP_DELAY_MS = 600;
/** a key press moves the edge this far; with Shift, `BIG_STEP` */
const STEP = 8;
const BIG_STEP = 40;
/** half of the 10px hit band — the app's rule for every resize target (#70) */
const HALF_BAND = 5;

/**
 * The sidebar's right edge (#217 D14, D28): drag to resize, past the minimum
 * to hide; the keyboard resizes too. It runs the window's full height — the
 * chrome band included, where it sits over the drag region — and is laid out
 * by the Frame, which keeps it mounted while a drag has hidden the sidebar so
 * the same gesture can bring it back.
 *
 * The gesture follows the chat panel's edge (#129): primary button and one
 * pointer, one store update per animation frame, the width saved once at the
 * end, and an unmount mid-drag ends the drag rather than stranding the cursor.
 */
export const SidebarResizeEdge = () => {
  const hidden = useSidebarStore((s) => s.hidden);
  const resizing = useSidebarStore((s) => s.resizing);
  const viewport = useViewportWidth();
  const visible = visibleSidebarWidth(
    useSidebarStore((s) => s.width),
    viewport,
  );
  /** what the window allows right now (D18) — the separator's maximum */
  const max = visibleSidebarWidth(SIDEBAR_MAX, viewport);
  /** ends the drag in flight */
  const dragRef = useRef<(() => void) | null>(null);
  const [tipY, setTipY] = useState<number | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTipY(null);
  };

  useEffect(
    () => () => {
      dragRef.current?.();
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );

  const resizeTo = (width: number) => {
    const store = useSidebarStore.getState();
    store.setWidth(Math.min(width, max));
    store.commitWidth();
  };

  const startDrag = (event: React.PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    hideTip();
    const pointerId = event.pointerId;
    // the edge stays where it was grabbed, not jumping to the pointer's x
    const offset = visible - event.clientX;
    useSidebarStore.getState().beginDrag();
    // the pointer leaves the 10px band at once — keep the cursor honest
    document.body.style.cursor = "col-resize";
    let frame = 0;
    let pending = visible;
    const flush = () => {
      frame = 0;
      useSidebarStore.getState().dragTo(Math.min(pending, max));
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pending = e.clientX + offset;
      // one update per frame: the sidebar, the band and the canvas all re-lay out on it
      if (frame === 0) frame = requestAnimationFrame(flush);
    };
    const stop = (e?: PointerEvent) => {
      if (e && e.pointerId !== pointerId) return;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        flush();
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      dragRef.current = null;
      useSidebarStore.getState().endDrag();
    };
    dragRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <div
      style={{ left: (hidden ? 0 : visible) - HALF_BAND }}
      // z-30: over the band (z-20) it runs through and over the sheet, whose
      // layers stack inside it; under the peek (z-45) and the docked sidebar's
      // menus (z-50), which share this stacking context — the Frame keeps the
      // sidebar out of the sheet's, so a menu crossing the edge takes its clicks.
      // nodelete: Backspace, Delete or Enter on the separator must not reach the
      // canvas selection (D27, T35)
      className="nodelete absolute inset-y-0 z-30 w-2.5"
    >
      {/* an <hr>: the separator role comes with it (the chat panel's edge does the same) */}
      <hr
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={visible}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={max}
        aria-valuetext={`${visible} pixels`}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerEnter={(e) => {
          if (dragRef.current) return;
          const y = e.clientY;
          if (tipTimer.current) clearTimeout(tipTimer.current);
          tipTimer.current = setTimeout(() => setTipY(y), TOOLTIP_DELAY_MS);
        }}
        onPointerLeave={hideTip}
        onKeyDown={(e) => {
          const step = e.shiftKey ? BIG_STEP : STEP;
          // from the store, not the render: key repeat outruns React
          const now = Math.min(useSidebarStore.getState().width, visible);
          if (e.key === "ArrowRight") resizeTo(now + step);
          else if (e.key === "ArrowLeft") resizeTo(now - step);
          // the window-splitter convention: Home is the minimum, End the maximum
          else if (e.key === "Home") resizeTo(SIDEBAR_MIN);
          else if (e.key === "End") resizeTo(max);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
        // h-auto: preflight gives an <hr> `height: 0`. The 2px `edge` line is
        // ::before, shown on hover, keyboard focus and while dragging (D28)
        className={`absolute inset-0 m-0 h-auto w-full cursor-col-resize overflow-visible border-0 outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-[2px] before:-translate-x-1/2 before:bg-edge before:content-[''] ${
          resizing
            ? "before:visible"
            : "before:invisible hover:before:visible focus-visible:before:visible"
        }`}
      />
      {tipY !== null ? (
        <div
          role="tooltip"
          style={{ top: tipY }}
          // inside the sidebar, at the pointer's height
          className="pointer-events-none absolute right-full mr-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink-surface px-2 py-1 text-[11px] font-medium text-surface"
        >
          <span className="block">Drag to resize</span>
          <span className="block text-on-ink-muted">drag past the edge to hide</span>
        </div>
      ) : null}
    </div>
  );
};
