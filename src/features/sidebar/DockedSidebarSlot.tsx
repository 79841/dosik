import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import { useVisibleSidebarWidth } from "../../shared/lib/sidebarLayout";
import {
  registerSidebarSlot,
  SLIDE_TIMING,
  useSidebarSlideStore,
} from "../../shared/lib/sidebarSlide";

/**
 * The docked sidebar's slot (canvas `TabsCollapse-Toggle`, hide / show
 * motion). Sliding, the slot narrows to 0 or widens from it over 200ms; the
 * sidebar keeps its width the whole way, pinned to the slot's right edge, so
 * it slides out to the left (in from the left) under the slot's clip and
 * nothing in it reflows. Leaving, it is out of the focus' and screen
 * readers' reach. Still, the slot is the sidebar's width and clips nothing.
 */
export const DockedSidebarSlot = ({ children }: { children: ReactNode }) => {
  const width = useVisibleSidebarWidth();
  const phase = useSidebarSlideStore((s) => s.phase);
  const box = useRef<HTMLDivElement>(null);

  useEffect(registerSidebarSlot, []);

  useLayoutEffect(() => {
    if (phase !== "entering") return;
    // laid out at width 0 first, so widening is a transition
    void box.current?.offsetWidth;
    useSidebarSlideStore.getState().entered();
  }, [phase]);

  if (phase === "closed") return null;
  const moving = phase === "opening" || phase === "closing";
  const shut = phase === "entering" || phase === "closing";
  const leaving = phase === "closing";
  return (
    <div
      ref={box}
      data-sidebar-slot=""
      inert={leaving}
      aria-hidden={leaving ? "true" : undefined}
      style={{ width: shut ? 0 : width }}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "width") {
          useSidebarSlideStore.getState().settle();
        }
      }}
      className={`flex h-full min-h-0 flex-none justify-end ${
        phase === "open" ? "" : "overflow-hidden"
      } ${moving ? `motion-safe:transition-[width] ${SLIDE_TIMING}` : ""}`}
    >
      {/* the sidebar's own width, set here and only here: the sidebar, or its crash screen, fills it */}
      <div style={{ width }} className="flex h-full min-h-0 flex-none">
        {children}
      </div>
    </div>
  );
};
