import { useLayoutEffect, useRef } from "react";

import { useDockedWidth, useSidebarStore } from "../../shared/lib/sidebarLayout";
import { SLIDE_TIMING, useSidebarSliding } from "../../shared/lib/sidebarSlide";
import {
  BAND_BUTTON,
  BAND_GAP,
  bandLeading,
  isMacPlatform,
  tabsLeft,
} from "../../shared/lib/windowChrome";
import { WindowControls } from "../../shared/ui/WindowControls";
import { HideSidebarButton } from "../sidebar/LibrarySidebar";
import { ShowSidebarButton } from "../sidebar/SidebarPeek";
import { DocumentTabs } from "./DocumentTabs";
import { MoreMenu } from "./MoreMenu";

/**
 * The chrome band (#217 R1, D19): the top 40px of the window, one strip the
 * full width — the window's drag handle (`deep`: Tauri leaves its buttons
 * out). Docked, its left "sidebar width" is the sidebar's top row: the
 * traffic lights' room (20–80) and Hide sidebar. Hidden, it is the whole tab
 * strip: lights, Show sidebar, the tabs, and ⋯ More at the right end. The
 * tabs and the band's end share one row, so the strip knows its room.
 * Everything in it is centred on y = 24, the native lights' centre line.
 *
 * It sits outside the content's error boundary, so whatever crashes below,
 * the window can still be dragged — and, off macOS, closed (#127).
 */
export const ChromeBand = ({ mac = isMacPlatform() }: { mac?: boolean }) => {
  const hidden = useSidebarStore((s) => s.hidden);
  // the docked sidebar sliding out or in: the tabs glide with its edge
  const sliding = useSidebarSliding();
  const focusAfter = useSidebarStore((s) => s.focusAfter);
  const docked = useDockedWidth();
  const hideSlot = useRef<HTMLDivElement>(null);
  const showSlot = useRef<HTMLDivElement>(null);

  // focus that was in what just went away moves to the button that brings it
  // back (D29): hiding → Show sidebar, docking → Hide sidebar
  useLayoutEffect(() => {
    if (!focusAfter) return;
    const slot = focusAfter === "show" ? showSlot.current : hideSlot.current;
    const button = slot?.querySelector<HTMLElement>("button");
    if (!button) return;
    button.focus();
    useSidebarStore.getState().clearFocusAfter();
  }, [focusAfter]);

  return (
    <div
      data-chrome-band
      data-tauri-drag-region="deep"
      // z-20: its menus and tooltips hang over the sheet and the sidebar.
      // nodelete: Backspace here must not delete the canvas selection (D27)
      className="nodelete relative z-20 h-10 flex-none select-none bg-frame"
    >
      {hidden ? (
        <div
          ref={showSlot}
          data-band-slot
          style={{ left: bandLeading(mac) }}
          className="absolute top-3 flex"
        >
          <ShowSidebarButton />
        </div>
      ) : (
        <div
          ref={hideSlot}
          data-band-slot
          // 8px in from the sidebar's right edge
          style={{ left: docked - BAND_GAP - BAND_BUTTON }}
          className="absolute top-3 flex"
        >
          <HideSidebarButton />
        </div>
      )}
      {/* the tabs take what the band's end leaves them (#218 D13) */}
      <div
        data-band-slot
        style={{ left: tabsLeft(hidden ? null : docked, mac) }}
        className={`absolute inset-y-0 right-0 flex ${
          sliding ? `motion-safe:transition-[left] ${SLIDE_TIMING}` : ""
        }`}
      >
        <DocumentTabs mac={mac} />
        <div
          data-band-end
          className={`flex flex-none items-start gap-2 pr-3 pt-3 ${hidden || !mac ? "pl-2" : ""}`}
        >
          {hidden ? <MoreMenu /> : null}
          <WindowControls platform={mac ? "mac" : "other"} />
        </div>
      </div>
    </div>
  );
};
