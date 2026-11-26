import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useLayoutEffect } from "react";

import { useAgentBridge } from "./features/agent/useAgentBridge";
import { ChatPanel } from "./features/ai/ChatPanel";
import { initAiKeys } from "./features/ai/keychain";
import { DiagramCanvas } from "./features/canvas/DiagramCanvas";
import {
  cancelSpaceTap,
  handleCanvasKeyDown,
  handleCanvasKeyUp,
} from "./features/canvas/canvasKeymap";
import { useCanvasUiStore } from "./features/canvas/canvasUiStore";
import { ImageView } from "./features/canvas/ImageView";
import { ViewportReveal } from "./features/canvas/ViewportReveal";
import { ZoomIsland } from "./features/canvas/ZoomIsland";
import { handleAppKeyDown } from "./features/chrome/appKeymap";
import { ChromeBand } from "./features/chrome/ChromeBand";
import { DOC_PANEL_ID, documentTabId, HOME_TAB_ID } from "./features/chrome/DocumentTabs";
import { useMenuEvents } from "./features/chrome/useMenuEvents";
import { EditBar } from "./features/editbar/EditBar";
import { Home } from "./features/home/Home";
import { useAppStore } from "./features/library/appStore";
import { useAutosave } from "./features/library/useAutosave";
import { useFlushOnClose } from "./features/library/useFlushOnClose";
import { useLibraryWatch } from "./features/library/useLibraryWatch";
import { useOpenRequests } from "./features/library/useOpenRequests";
import { useTabSession } from "./features/library/tabSession";
import { useTrayActions } from "./features/library/useTrayActions";
import { ShapePalette } from "./features/palette/ShapePalette";
import { DockedSidebarSlot } from "./features/sidebar/DockedSidebarSlot";
import { LibrarySidebar } from "./features/sidebar/LibrarySidebar";
import { SidebarPeek } from "./features/sidebar/SidebarPeek";
import { SidebarResizeEdge } from "./features/sidebar/SidebarResizeEdge";
import { Toolbar } from "./features/toolbar/Toolbar";
import { EDITOR_TOAST_BOTTOM, TOAST_BOTTOM } from "./shared/lib/editorLayout";
import { useSidebarStore } from "./shared/lib/sidebarLayout";
import { useSidebarSlideStore, useSidebarSliding } from "./shared/lib/sidebarSlide";
import { useWebviewGuards } from "./shared/lib/webviewGuards";
import { useWindowFrameWatch } from "./shared/lib/windowFrame";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { Toaster } from "./shared/ui/Toaster";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { useSettingsStore } from "./features/settings/settingsStore";

/**
 * The editor's sheet (#219 D1): the toolbar row (the diagram's path and
 * actions) across the top, then the body — the canvas column, with its
 * islands floating in it, and the docked side panel beside it. The panel
 * takes its width from the canvas instead of covering it.
 *
 * The canvas column is the box the islands, the flyouts and the popovers
 * keep inside (`data-editor-canvas`) — a diagram is one canvas, so it is no
 * tabpanel of its own: the document tab's panel holds the sheet (#229 D3).
 * It starts no stacking context and does not clip: React Flow clips its own
 * box, and the canvas's context menus (fixed, z-50) must draw over the panel
 * (D17).
 */
export const Workspace = () => {
  useEffect(() => {
    window.addEventListener("keydown", handleCanvasKeyDown);
    // a Space tap opens the image view on release; a press of the pointer
    // meanwhile makes it Space+drag panning instead (#279)
    window.addEventListener("keyup", handleCanvasKeyUp);
    window.addEventListener("pointerdown", cancelSpaceTap, true);
    return () => {
      window.removeEventListener("keydown", handleCanvasKeyDown);
      window.removeEventListener("keyup", handleCanvasKeyUp);
      window.removeEventListener("pointerdown", cancelSpaceTap, true);
    };
  }, []);
  // the toasts rest on the row above the bottom islands while the editor is
  // up, selection or not (#231 D18) — the editor's own variable, so the edit
  // bar or Home's board clearing theirs never takes it (#221)
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dsk-toast-editor-lift", `${EDITOR_TOAST_BOTTOM - TOAST_BOTTOM}px`);
    return () => {
      root.style.removeProperty("--dsk-toast-editor-lift");
    };
  }, []);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <div
          data-editor-canvas
          className="relative min-w-0 flex-1 bg-[var(--dsk-canvas-bg,#FFFFFF)]"
        >
          <DiagramCanvas />
          {/* the viewport follows every document swap (open, new, set_diagram, clear) from here */}
          <ViewportReveal />
          <ShapePalette />
          <EditBar />
          <ZoomIsland />
        </div>
        <ChatPanel />
      </div>
      {/* a modal over the whole window — the top layer, wherever it sits */}
      <ImageView />
    </div>
  );
};

/**
 * Home or the editor — never both (#114). Switching between document tabs
 * keeps the editor mounted and swaps only the document; Home ↔ a document
 * unmounts and mounts it (#218 D23). What guards the documents lives a level
 * up, in `Frame`, outside this one's error boundary.
 */
const Shell = () => {
  const view = useAppStore((s) => s.view);
  // the OS's open requests wait in Rust's queue while this is down, and are
  // taken when "Try again" mounts it again
  useOpenRequests();
  useTrayActions();
  // moves plain-text API keys into the system keychain, then loads them (#17)
  useEffect(() => {
    void initAiKeys();
  }, []);
  return view === "home" ? (
    <Home />
  ) : (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
};

/**
 * The window (#217 D19): the chrome band across the top, then the library
 * sidebar beside the sheet the tabs open into, with the peek floating over
 * both while the sidebar is hidden.
 *
 * Three error boundaries, so a crash takes as little as it can: the content's
 * (Home or the editor), the sidebar's, and the outer last resort. The band
 * sits outside the first two — whatever crashes, the window can still be
 * dragged and, off macOS, closed (#127). The toasts sit outside the content's
 * boundary too, in the sheet, so they rise from the middle of the content,
 * not of the window (D24) — and, in the editor, of the canvas (#219 D16).
 */
const Frame = () => {
  const hidden = useSidebarStore((s) => s.hidden);
  const resizing = useSidebarStore((s) => s.resizing);
  // hiding and showing slide the docked sidebar (canvas TabsCollapse-Toggle)
  const sliding = useSidebarSliding();
  /** the docked sidebar is on screen — sliding out included */
  const slotted = useSidebarSlideStore((s) => s.phase !== "closed");
  const view = useAppStore((s) => s.view);
  const activeTab = useAppStore((s) => s.activeTab);
  // the Settings dialog shows the toasts while it is up — the sheet's would sit under it (#252)
  const settingsOpen = useSettingsStore((s) => s.open);
  // the image view holds the notices while it is up, as Settings does (#279)
  const imageViewOpen = useCanvasUiStore((s) => s.imageView !== null);

  // What keeps the documents safe renders nothing, so it lives here, outside
  // the content's boundary: a crash screen in the sheet still asks about
  // every tab's unsaved file and writes the pending autosave when the window
  // closes, the session follows the strip (which still works), and the
  // bridge still answers — ops apply to the active tab, as ever, instead of
  // timing out into a "queued" that never lands (#218). Above the
  // Home/editor switch too: ops must reach the app while Home is up (they
  // create a project), and a pending write must not die with the editor.
  useAgentBridge();
  useAutosave();
  useFlushOnClose();
  // the tabs across restarts: saved as they change, the active one reopened (#218 D15)
  useTabSession();
  // what changes on disk outside the app reaches the library and the tabs (#253)
  useLibraryWatch();

  // ⌘\, ⌘O and the tab keys, on Home and in the editor alike (#217 D22,
  // #218 D12) — in the capture phase, so a tab key reaches nothing else
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleAppKeyDown(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // File ▸ Close Tab (⌘W) on macOS
  useMenuEvents();
  // off macOS, the caption buttons and the band follow the window: maximized,
  // focused, full screen
  useWindowFrameWatch();
  // off macOS, no browser menu on a right click and no file opened by a stray drop
  useWebviewGuards();

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-frame">
      <ChromeBand />
      <div className="relative flex min-h-0 flex-1">
        <DockedSidebarSlot>
          <ErrorBoundary>
            <LibrarySidebar />
          </ErrorBoundary>
        </DockedSidebarSlot>
        <div
          id={DOC_PANEL_ID}
          role="tabpanel"
          aria-labelledby={activeTab === null ? HOME_TAB_ID : documentTabId(activeTab)}
          // the sheet's top-left corner rounds where the sidebar meets it —
          // unless the first tab, Home, is the active one: its fillet joins
          // the sheet there instead (the design's Main board).
          // isolate: the content's own layers (toolbar, chat, toasts, menus)
          // stack inside the sheet, under the band, the resize edge and the
          // peek. Only the sheet — the sidebar's menus (fixed, z-50) cross the
          // edge (z-30) and must draw over it, so they stay out of it.
          className={`relative isolate min-w-0 flex-1 overflow-hidden bg-surface ${
            slotted && view === "editor" ? "rounded-tl-lg" : ""
          }`}
        >
          <ErrorBoundary>
            <Shell />
          </ErrorBoundary>
          {/* every "Saved" / "Error: …" the app raises is shown here — or in Settings or the image view while one is up */}
          {settingsOpen || imageViewOpen ? null : <Toaster />}
        </div>
      </div>
      {/* mounted through a drag that hides the sidebar, so the same gesture can
          bring it back; back from a slide only once the sidebar has landed */}
      {(!hidden && !sliding) || resizing ? <SidebarResizeEdge /> : null}
      <SidebarPeek />
      <SettingsDialog />
    </div>
  );
};

export const App = () => (
  <ErrorBoundary>
    <Frame />
  </ErrorBoundary>
);

export default App;
