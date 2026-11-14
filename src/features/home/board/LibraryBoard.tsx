import { Plus } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  ISLAND_GAP,
  ISLAND_INSET,
  TOAST_BOTTOM,
  ZOOM_ISLAND_HEIGHT,
} from "../../../shared/lib/editorLayout";
import { focusStillWith } from "../../../shared/lib/focusGuard";
import { besidePointer } from "../../../shared/ui/Menu";
import { useAppStore } from "../../library/appStore";
import { DASHBOARD, resolveHomeView } from "../../library/homeView";
import { useLibraryStore } from "../../library/libraryStore";
import { findFolder } from "../../library/libraryTree";
import { HomeNotice, LoadFailed, useSlow } from "../homeParts";
import { INK_BUTTON } from "../homeStyles";
import { newProjectAt } from "./boardActions";
import { type BoardApi, BoardApiContext } from "./boardApi";
import { BoardFrame } from "./BoardFrame";
import { BoardMenus } from "./BoardMenus";
import { BoardZoom, HintPill } from "./BoardIslands";
import { NO_SCROLL, unscroll } from "./boardParts";
import { effectiveBoards, persistentLayout, renderLayout } from "./boardLayout";
import {
  folderKey,
  frameKey,
  type NavKey,
  navItems,
  readingOrder,
  spatialNext,
  standIn,
} from "./boardNav";
import { useBoardStore } from "./boardStore";
import { BoardSurface } from "./BoardSurface";
import { DEFAULT_ZOOM, revealPan, type Size, toWorld, type Viewport } from "./boardViewport";
import { useBoardCamera } from "./useBoardCamera";
import { useBoardCommit } from "./useBoardCommit";

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);
/** keys typed into these are theirs — the board's Escape leaves them alone */
const OWN_KEYS = "input, textarea, select, [contenteditable=true], [role=menu], [role=dialog]";
const RESTING: Viewport = { x: 0, y: 0, zoom: DEFAULT_ZOOM };

/**
 * How far the toasts rise on the board: above the bottom islands (12 in, the
 * zoom island 36 tall) with 8 to spare, 56 up — the hint pill spans most of
 * the row, so Home's 16 would put them on it (#231 D18: clearing the islands
 * wins). The editor holds them over its islands the same way.
 */
export const BOARD_TOAST_LIFT = ISLAND_INSET + ZOOM_ISLAND_HEIGHT + ISLAND_GAP - TOAST_BOTTOM;

/**
 * Home's Canvas view (#221): the whole library as one board. Projects are
 * dashed frames at the places kept in their folders, the folders and
 * diagrams right under them cards in them (#231 D13); Home's `homeView` is
 * the board's focus (D2, #229 D18, #231 D1) — a project's frame the camera
 * goes to, or a folder below a project opened in place, with every folder
 * between, as sub-frames in that frame (#231 D14). Esc goes out one level
 * at a time. It fills Home's body under the header row, which says where
 * the camera is (#231 D12); the hint pill and the zoom island float over
 * it, and the one open menu sits at its root. The keyboard moves through
 * its items by place (D20).
 */
export const LibraryBoard = () => {
  const folders = useLibraryStore((s) => s.folders);
  const readFailed = useLibraryStore((s) => s.readFailed);
  const homeView = useAppStore((s) => s.homeView);
  const overlay = useBoardStore((s) => s.overlay);
  const renaming = useBoardStore((s) => s.renaming);
  const section = useRef<HTMLElement>(null);
  const hintId = useId();
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const slow = useSlow(folders === null);
  const view = resolveHomeView(homeView, folders);
  const focus = view.kind === "folder";

  const kept = useMemo(
    () => (folders ? persistentLayout(folders, effectiveBoards(folders, overlay), {}) : null),
    [folders, overlay],
  );
  // what is drawn: the kept places, the folder in view opened in place (#231 D14)
  const viewed = view.kind === "folder" ? view.folder : null;
  const layout = useMemo(() => (kept ? renderLayout(kept, viewed) : null), [kept, viewed]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useBoardCommit(folders);
  useBoardCamera(view, layout, size);

  useLayoutEffect(() => {
    const el = section.current;
    if (!el) return;
    const measure = () =>
      setSize((now) =>
        now.width === el.clientWidth && now.height === el.clientHeight
          ? now
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // the toasts share the bottom with the hint pill and the zoom island — the
  // board's own variable: the edit bar clears its lift as Workspace goes, in
  // the same commit this one comes in (#221)
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--dsk-toast-board-lift", `${BOARD_TOAST_LIFT}px`);
    return () => {
      root.style.removeProperty("--dsk-toast-board-lift");
    };
  }, []);

  // focus asked for before the item it names is drawn — taken after the next draw
  const pendingFocus = useRef<string | null>(null);
  /** the board item that has the focus, while it has it — a change may take it off the board */
  const held = useRef<{ key: string; el: Element } | null>(null);
  /** whether the last thing done on the board was a key — focus then brings its item into view */
  const byKeyboard = useRef(false);

  const reveal = useCallback((key: string) => {
    const now = layoutRef.current;
    const item = now ? navItems(now).find((i) => i.key === key) : null;
    const board = useBoardStore.getState();
    if (!item || sizeRef.current.width <= 0) return;
    const at = board.viewport ?? RESTING;
    const next = revealPan(at, item.rect, sizeRef.current);
    if (next !== at) board.setViewport(next, true);
  }, []);

  const focusNow = useCallback((key: string): boolean => {
    const el = section.current?.querySelector<HTMLElement>(`[data-board-key="${key}"]`);
    if (!el) return false;
    useBoardStore.getState().setCurrent(key);
    // never by scrolling: the board's camera is its transform, not a scroll offset (#221)
    el.focus({ preventScroll: true });
    return true;
  }, []);

  // the one place focus finds its item again: focus asked for before its item
  // is drawn, and focus whose item a change took away — a card moved or
  // folded, a stack unfolded — which would otherwise fall to the page and send
  // the Tab stop back to the first item (#221, D2). It goes to
  // that item drawn anew, else to what holds it now.
  useLayoutEffect(() => {
    if (!layout) return;
    let key = pendingFocus.current;
    pendingFocus.current = null;
    if (!key) {
      const lost = held.current;
      const active = document.activeElement;
      if (!lost || lost.el.isConnected || (active && active !== document.body)) return;
      key = lost.key;
    }
    held.current = null;
    const target = standIn(layout, key);
    if (target) focusNow(target);
  });

  // a frame or a folder card being named comes into view — New project may
  // have had to place it out of sight, a new folder's card may be off screen
  const shownRename = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (renaming === shownRename.current) return;
    if (!renaming) {
      shownRename.current = null;
      return;
    }
    // not drawn: nothing to show — the rename ends (below)
    const box =
      layout?.byId.get(renaming) ??
      (layout ? navItems(layout).find((i) => i.key === folderKey(renaming))?.rect : undefined);
    if (!box || size.width <= 0) return;
    shownRename.current = renaming;
    const board = useBoardStore.getState();
    const at = board.viewport ?? RESTING;
    const next = revealPan(at, box, size);
    if (next !== at) board.setViewport(next, true);
  }, [renaming, layout, size]);

  // a field taken off the page sends no blur (WebKit's focus fixup sends
  // none), so the rename would stay and open the field again — taking the
  // focus — when its frame or card is drawn later (#231 D8·D13): it goes with the board, and once what it names is not drawn — a card
  // folded into its project's stack, a project gone. Here, not in the frame
  // or the card: StrictMode's second mount of one drawn already renaming —
  // New project's frame — would end it
  useEffect(() => () => useBoardStore.getState().setRenaming(null), []);
  useEffect(() => {
    if (!renaming || !layout) return;
    const named = new Set([frameKey(renaming), folderKey(renaming)]);
    if (!navItems(layout).some((i) => named.has(i.key))) {
      useBoardStore.getState().setRenaming(null);
    }
  }, [renaming, layout]);

  // a new folder's name asked of a card the board does not draw — it went
  // into a collapsed project's stack (#231 D13): no field opens, and the
  // request does not wait for the card the stack unfolds later (#231 C1). A
  // card that is drawn takes it itself
  const renameRequest = useAppStore((s) => s.folderRenameRequest);
  useEffect(() => {
    if (!renameRequest || !layout) return;
    if (navItems(layout).some((i) => i.key === folderKey(renameRequest.id))) return;
    useAppStore.getState().takeFolderRename();
  }, [renameRequest, layout]);

  // one level out (#231 D14): a folder closes into the folder it is in — its
  // card takes the focus — and a project into the whole board, its name
  // taking the focus; the camera follows the view. A move inside the board:
  // no heading takes the focus (#221 D2)
  const leave = useCallback((folder?: string) => {
    const folders = useLibraryStore.getState().folders;
    const now = resolveHomeView(useAppStore.getState().homeView, folders);
    const closing = folder ?? (now.kind === "folder" ? now.folder : null);
    if (closing === null) return;
    const path = findFolder(folders ?? [], closing)?.path ?? [];
    const parent = path.at(-2);
    if (parent) {
      pendingFocus.current = folderKey(closing);
      useAppStore.getState().setHomeView({ kind: "folder", folder: parent.id });
      return;
    }
    if (path[0]) pendingFocus.current = frameKey(path[0].id);
    useAppStore.getState().setHomeView(DASHBOARD);
  }, []);

  const api = useMemo<BoardApi>(
    () => ({
      toBoard: (client) => {
        const box = section.current?.getBoundingClientRect();
        return toWorld(useBoardStore.getState().viewport ?? RESTING, {
          x: client.x - (box?.left ?? 0),
          y: client.y - (box?.top ?? 0),
        });
      },
      layout: () => layoutRef.current ?? { frames: [], byId: new Map() },
      overIsland: (client) =>
        [...(section.current?.querySelectorAll("[data-board-island]") ?? [])].some((el) => {
          const box = el.getBoundingClientRect();
          return (
            client.x >= box.left &&
            client.x <= box.right &&
            client.y >= box.top &&
            client.y <= box.bottom
          );
        }),
      focusItem: (key) => {
        if (!focusNow(key)) pendingFocus.current = key;
      },
      holdsFocus: () => focusStillWith(section.current),
      leave,
    }),
    [focusNow, leave],
  );

  // one Tab stop on the board: the last item used, else the first in reading order
  useEffect(() => {
    if (!layout) return;
    const items = navItems(layout);
    const { current } = useBoardStore.getState();
    if (current && items.some((i) => i.key === current)) return;
    useBoardStore.getState().setCurrent(readingOrder(items)[0]?.key ?? null);
  }, [layout]);

  // Escape goes out of a focus one level (#231 D14) — from the board, from
  // Home's header row above it (where its path and switch moved from the
  // islands, #231 D12), or from nowhere in particular
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const at = e.target instanceof Element ? e.target : null;
      const sheet = section.current?.closest("main") ?? section.current;
      const inside = !at || at === document.body || sheet?.contains(at);
      if (!inside || at?.closest(OWN_KEYS) || useBoardStore.getState().menu) return;
      const now = resolveHomeView(
        useAppStore.getState().homeView,
        useLibraryStore.getState().folders,
      );
      if (now.kind !== "folder") return;
      e.preventDefault();
      leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    byKeyboard.current = true;
    if (!NAV_KEYS.has(e.key) || !layout || e.altKey || e.metaKey || e.ctrlKey) return;
    const key = (e.target as Element).closest("[data-board-key]")?.getAttribute("data-board-key");
    if (!key) return;
    e.preventDefault();
    const next = spatialNext(navItems(layout), key, e.key as NavKey);
    if (next !== key) focusNow(next);
  };

  const onFocus = (e: React.FocusEvent) => {
    const key = e.target.getAttribute("data-board-key");
    held.current = key ? { key, el: e.target } : null;
    if (key && byKeyboard.current) reveal(key);
  };

  const failed = readFailed && (folders?.length ?? 0) === 0;
  const empty = folders !== null && folders.length === 0 && !failed;
  const centre = () =>
    toWorld(useBoardStore.getState().viewport ?? RESTING, {
      x: size.width / 2,
      y: size.height / 2,
    });

  return (
    <BoardApiContext.Provider value={api}>
      <section
        ref={section}
        aria-label="Library canvas"
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        onPointerDown={() => {
          byKeyboard.current = false;
        }}
        onFocus={onFocus}
        // gone to another element (out of the board, or another item that says
        // so itself) — not to nowhere, as an item taken off the page sends it
        onBlur={(e) => {
          if (e.relatedTarget) held.current = null;
        }}
        // never a scroll box: an offset would skew every point the camera maps
        // (#221)
        onScroll={unscroll}
        className={`relative h-full w-full ${NO_SCROLL} bg-surface`}
      >
        <BoardSurface
          onEmptyContextMenu={(client) =>
            // the menu opens beside the pointer; the project goes at the pointer (D15)
            useBoardStore.getState().openMenu({
              kind: "canvas",
              at: besidePointer(client),
              board: api.toBoard(client),
            })
          }
        >
          {layout?.frames.map((frame) => (
            <BoardFrame key={frame.id} frame={frame} />
          ))}
        </BoardSurface>
        {folders === null && slow ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading projects"
            className="pointer-events-none absolute inset-0 flex items-center justify-center gap-6"
          >
            <div className="h-[194px] w-[280px] animate-pulse rounded-xl bg-frame" />
            <div className="h-[194px] w-[240px] animate-pulse rounded-xl bg-frame" />
          </div>
        ) : null}
        {failed ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto w-full max-w-md">
              <LoadFailed />
            </div>
          </div>
        ) : null}
        {empty ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto w-full max-w-md">
              <HomeNotice
                title="No projects yet"
                action={
                  <button
                    type="button"
                    onClick={() =>
                      void newProjectAt(centre(), () => focusStillWith(section.current))
                    }
                    className={INK_BUTTON}
                  >
                    <Plus size={15} strokeWidth={1.9} aria-hidden="true" />
                    New project
                  </button>
                }
              >
                Right-click the canvas to make one, or use + in the sidebar.
              </HomeNotice>
            </div>
          </div>
        ) : null}
        <HintPill id={hintId} focus={focus} />
        <BoardZoom size={size} layout={layout} disabled={failed} />
        {folders ? <BoardMenus folders={folders} layout={layout} /> : null}
      </section>
    </BoardApiContext.Provider>
  );
};
