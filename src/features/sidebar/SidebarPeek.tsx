import { PanelLeftOpen, Pin } from "lucide-react";
import { useEffect, useId } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { keyshortcuts, shortcutLabel } from "../../shared/lib/shortcutLabel";
import { useSidebarStore, useVisibleSidebarWidth } from "../../shared/lib/sidebarLayout";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { ICON_STROKE, IconButton, SMALL_ICON_SIZE } from "../../shared/ui/IconButton";
import { LibraryBody } from "./LibrarySidebar";

/** resting on Show sidebar this long opens the peek — crossing the band on the way does not (D16) */
export const PEEK_OPEN_DELAY_MS = 120;
/** time to cross the 12px between the button (bottom y=36) and the panel (top y=48) */
export const PEEK_CLOSE_DELAY_MS = 300;

const PEEK_ID = "library-peek";

/**
 * The peek's two timers, shared by the Show sidebar button in the band and
 * the panel under it: two components in different places, one hover.
 */
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const cancelOpen = () => {
  if (openTimer) clearTimeout(openTimer);
  openTimer = null;
};
const cancelClose = () => {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
};

/**
 * Whether the panel has to stay: keyboard focus is in it — on a row, in a
 * rename field, or in a menu it opened (the menus render inside it, so the
 * pointer on one is still on the panel).
 */
const panelHoldsFocus = (): boolean =>
  !!document.getElementById(PEEK_ID)?.contains(document.activeElement);

const scheduleClose = () => {
  cancelClose();
  if (!useSidebarStore.getState().peek) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (!panelHoldsFocus()) useSidebarStore.getState().closePeek();
  }, PEEK_CLOSE_DELAY_MS);
};

/**
 * Show sidebar, in the band while the sidebar is hidden (R4, D16). A click —
 * or Enter, Space — docks it. Resting the pointer on it peeks: the sidebar
 * floats over the content. Only from here, never from the window's left
 * edge, where the shape strip lives. It has no visual tooltip, since hovering
 * opens the peek; its name and shortcut are for assistive tech.
 */
export const ShowSidebarButton = () => {
  const peek = useSidebarStore((s) => s.peek);
  useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [],
  );
  return (
    <button
      type="button"
      aria-label="Show sidebar"
      aria-keyshortcuts={keyshortcuts("\\")}
      aria-controls={peek ? PEEK_ID : undefined}
      // what docking takes off screen: focus here goes on to Hide sidebar (D29)
      data-sidebar-opener=""
      onPointerEnter={() => {
        cancelClose();
        if (useSidebarStore.getState().peek) return;
        cancelOpen();
        openTimer = setTimeout(() => {
          openTimer = null;
          useSidebarStore.getState().openPeek();
        }, PEEK_OPEN_DELAY_MS);
      }}
      onPointerLeave={() => {
        cancelOpen();
        scheduleClose();
      }}
      onClick={() => {
        cancelOpen();
        cancelClose();
        useSidebarStore.getState().show();
      }}
      className={`flex h-6 w-6 items-center justify-center rounded-[5px] transition-colors ${FOCUS_RING} ${
        peek ? "bg-selected text-ink" : "text-icon hover:bg-hover"
      }`}
    >
      <PanelLeftOpen size={SMALL_ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </button>
  );
};

/**
 * The hidden sidebar, floating over the content (R5, D16): left 8, top 48,
 * bottom 8, the chosen width, `shadow-overlay`. Nothing underneath moves. It
 * fades in — opacity only: a transform here would misplace the tree's fixed
 * menus (#206). Its header is "Library" with Pin; below it, the docked
 * sidebar's own body.
 */
export const SidebarPeek = () => {
  const hidden = useSidebarStore((s) => s.hidden);
  const peek = useSidebarStore((s) => s.peek);
  const width = useVisibleSidebarWidth();
  const titleId = useId();
  const open = hidden && peek;

  // Escape closes it from anywhere; inside, a menu or a rename field has it first
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[role=menu]") || target?.tagName === "INPUT") return;
      useSidebarStore.getState().closePeek();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <aside
      id={PEEK_ID}
      aria-labelledby={titleId}
      data-sidebar-region=""
      style={{ width }}
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
      onBlur={(e) => {
        // focus left the panel for good: close as the pointer would have —
        // unless the pointer is still on it; its leaving closes the panel then
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (e.currentTarget.matches(":hover")) return;
        scheduleClose();
      }}
      // z-[45]: over the chat (35) and the toasts (40), under the menus (50).
      // nodelete: Backspace in here must not delete the canvas selection (D27)
      className="nodelete fixed bottom-2 left-2 top-12 z-[45] flex flex-col rounded-xl bg-frame px-2 pb-2 opacity-100 shadow-overlay transition-opacity duration-150 starting:opacity-0"
    >
      <div className="flex h-9 flex-none items-center pl-2">
        <span
          id={titleId}
          className="flex-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-strong"
        >
          Library
        </span>
        <IconButton
          label="Keep sidebar open"
          shortcut={shortcutLabel("\\")}
          keyshortcuts={keyshortcuts("\\")}
          onClick={() => useSidebarStore.getState().pin()}
          size={24}
          align="end"
        >
          <Pin size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </IconButton>
      </div>
      {/* the docked sidebar's boundary, here too: a crash in the tree leaves the header and Pin */}
      <ErrorBoundary>
        <LibraryBody />
      </ErrorBoundary>
    </aside>
  );
};
