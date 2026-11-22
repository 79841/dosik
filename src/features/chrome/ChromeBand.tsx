import { type MouseEvent, useLayoutEffect, useRef } from "react";

import { useDockedWidth, useSidebarStore } from "../../shared/lib/sidebarLayout";
import { SLIDE_TIMING, useSidebarSliding } from "../../shared/lib/sidebarSlide";
import {
  bandLeading,
  hideSidebarLeft,
  isMacPlatform,
  isOnDragRegion,
  tabsLeft,
} from "../../shared/lib/windowChrome";
import { showWindowMenu, useWindowFrame } from "../../shared/lib/windowFrame";
import { WindowControls } from "../../shared/ui/WindowControls";
import { HideSidebarButton } from "../sidebar/LibrarySidebar";
import { ShowSidebarButton } from "../sidebar/SidebarPeek";
import { DocumentTabs } from "./DocumentTabs";
import { MoreMenu } from "./MoreMenu";

/**
 * The chrome band (#217 R1, D19): the top 40px of the window, one strip the
 * full width — the window's drag handle (`deep`: Tauri leaves its buttons
 * out). Docked, its left "sidebar width" is the sidebar's top row: the
 * traffic lights' room (20–80) and Hide sidebar — off macOS, with no lights,
 * Hide sidebar at the left edge instead, where Show sidebar is while the
 * sidebar is hidden, so the toggle stays put. Hidden, it is the whole tab
 * strip: lights, Show sidebar, the tabs, and ⋯ More at the right end. The
 * tabs and the band's end share one row, so the strip knows its room.
 * Everything in it is centred on y = 24, the native lights' centre line.
 *
 * It sits outside the content's error boundary, so whatever crashes below,
 * the window can still be dragged — and, off macOS, closed (#127).
 *
 * Off macOS it is the window's title bar (the canvas's Win-Caption): the
 * caption buttons flush with its top-right corner, and a right click on an
 * empty place opens Windows' window menu. In full screen it stays for the
 * tabs but stops being a title bar — no caption buttons, no drag, no
 * double-click maximize, no window menu — and ⋯ More goes back to 12 from the
 * edge.
 */
export const ChromeBand = ({ mac = isMacPlatform() }: { mac?: boolean }) => {
  const hidden = useSidebarStore((s) => s.hidden);
  // the docked sidebar sliding out or in: the tabs glide with its edge
  const sliding = useSidebarSliding();
  const focusAfter = useSidebarStore((s) => s.focusAfter);
  const docked = useDockedWidth();
  const fullscreen = useWindowFrame((s) => s.fullscreen);
  // off macOS and not in full screen: the band is a title bar, with caption buttons
  const titleBar = !mac && !fullscreen;
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

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (mac || !isOnDragRegion(e.target)) return;
    e.preventDefault();
    if (titleBar) showWindowMenu(true);
  };

  return (
    <div
      data-chrome-band
      data-tauri-drag-region={mac || titleBar ? "deep" : undefined}
      onContextMenu={onContextMenu}
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
          style={{ left: hideSidebarLeft(docked, mac) }}
          className="absolute top-3 flex"
        >
          <HideSidebarButton atLeftEdge={!mac} />
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
          // the caption buttons touch the corner; without them the end keeps 12 from the edge
          className={`flex flex-none items-start ${hidden || titleBar ? "pl-2" : ""} ${titleBar ? "" : "pr-3"}`}
        >
          {hidden ? (
            <div data-band-more className={`pt-3 ${titleBar ? "pr-2" : ""}`}>
              <MoreMenu />
            </div>
          ) : null}
          <WindowControls platform={mac ? "mac" : "other"} />
        </div>
      </div>
    </div>
  );
};
