import { useEffect, useState } from "react";
import { create, createStore, type StateCreator } from "zustand";

import { shortcutLabel } from "./shortcutLabel";
import { useToastStore } from "./toastStore";
import { isMacPlatform } from "./windowChrome";

/**
 * The library sidebar's layout (#217): hidden or docked, how wide, and the
 * peek that floats it over the content while it is hidden. It lives in
 * shared/lib, not in the sidebar feature, because the chat panel, the toolbar
 * and the window chrome all size themselves by it.
 */

/** the design system's `sidebar-width` / `sidebar-min` / `sidebar-max` */
export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 400;
/**
 * Dragging the edge hides the sidebar only this far past the minimum (D14):
 * a drag that overshoots the minimum a little must not hide it. The 40px of
 * slack is the VS Code family's.
 */
export const SIDEBAR_HIDE_BELOW = SIDEBAR_MIN - 40;
/**
 * What the content keeps beside a docked sidebar (D18): 960 − 248, so the
 * smallest window shows the design's default and no wider.
 */
export const CONTENT_RESERVE = 712;

const STORAGE_KEY = "dosik.sidebar";

/** what survives a restart (D17); the peek and the tree's folds do not */
export interface SidebarPrefs {
  hidden: boolean;
  /** the width the user chose — the one on screen may be narrower (D18) */
  width: number;
  /** the "Sidebar hidden" toast has been shown once (D15) */
  hinted: boolean;
}

const DEFAULT_PREFS: SidebarPrefs = { hidden: false, width: SIDEBAR_WIDTH, hinted: false };

/** a chosen width: a whole number in 200–400; anything not a number is the default */
export const clampSidebarWidth = (width: number): number =>
  Number.isFinite(width)
    ? Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)))
    : SIDEBAR_WIDTH;

/**
 * The width on screen (D18): the chosen one, squeezed so the content keeps
 * `CONTENT_RESERVE`. The choice itself is kept, and comes back when the window
 * widens — the chat panel's chosen/shown rule.
 */
export const visibleSidebarWidth = (width: number, viewport: number): number =>
  Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, viewport - CONTENT_RESERVE, width));

type Layout = Pick<SidebarPrefs, "hidden" | "width">;

/** how much of the window a docked sidebar takes; 0 when hidden (the peek takes none) */
export const dockedWidth = ({ hidden, width }: Layout, viewport: number): number =>
  hidden ? 0 : visibleSidebarWidth(width, viewport);

/** the window less the docked sidebar — what the editor and Home are laid out in (D23, D24) */
export const contentWidth = (layout: Layout, viewport: number): number =>
  viewport - dockedWidth(layout, viewport);

/**
 * One step of an edge drag (D14). `x` is where the pointer wants the edge;
 * `wasHidden` is whether this same gesture has already hidden the sidebar —
 * once hidden, it comes back only past the minimum, so wobbling around 160
 * does not flicker it in and out.
 */
export const resolveEdgeDrag = (x: number, wasHidden: boolean): Layout => {
  const hidden = x < SIDEBAR_HIDE_BELOW || (wasHidden && x < SIDEBAR_MIN);
  return { hidden, width: clampSidebarWidth(x) };
};

/** the saved layout; any part that is missing, broken or out of range is the default */
export const loadSidebarPrefs = (): SidebarPrefs => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_PREFS };
    const { hidden, width, hinted } = value as Record<string, unknown>;
    return {
      hidden: typeof hidden === "boolean" ? hidden : DEFAULT_PREFS.hidden,
      width: typeof width === "number" ? clampSidebarWidth(width) : DEFAULT_PREFS.width,
      hinted: typeof hinted === "boolean" ? hinted : DEFAULT_PREFS.hinted,
    };
  } catch {
    // blocked storage or a broken value — the sidebar still works, as it starts
    return { ...DEFAULT_PREFS };
  }
};

export const saveSidebarPrefs = (prefs: SidebarPrefs): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // a full or blocked store must not break hiding or resizing
  }
};

/**
 * Where keyboard focus goes after the sidebar hides or docks (D29): to the
 * button that brings it back, when focus was in what just went away.
 */
export type SidebarFocusTarget = "show" | "hide";

export interface SidebarState extends SidebarPrefs {
  /** floating over the content from the Show sidebar button (D16) — never saved */
  peek: boolean;
  /** an edge drag is under way: the edge stays mounted even while the drag hides the sidebar */
  resizing: boolean;
  /** a focus move the chrome owes after the last hide/show; it clears it when done */
  focusAfter: SidebarFocusTarget | null;
  hide: () => void;
  /** docks it — from hidden, or from the peek */
  show: () => void;
  toggle: () => void;
  /** the live width, while a resize is under way — not saved */
  setWidth: (width: number) => void;
  /** saves the width — at the end of a gesture or a keyboard step */
  commitWidth: () => void;
  openPeek: () => void;
  closePeek: () => void;
  /** the peek's Pin: docks the sidebar */
  pin: () => void;
  beginDrag: () => void;
  /** the pointer wants the edge at `x`: follows, hides or comes back (D14) */
  dragTo: (x: number) => void;
  /** saves once; a gesture that ended hidden keeps the width it started with */
  endDrag: () => void;
  clearFocusAfter: () => void;
}

/** whether keyboard focus sits inside an element marked with this attribute */
const focusInside = (selector: string): boolean => {
  const active = document.activeElement as HTMLElement | null;
  return !!active?.closest?.(selector);
};

/** the sidebar, the peek and the Hide button — what hiding takes off screen */
export const SIDEBAR_REGION = "data-sidebar-region";
/** the Show sidebar button and the More menu — what docking takes off screen */
export const SIDEBAR_OPENER = "data-sidebar-opener";

/** the store's state and actions, starting from what is saved; `mac` picks the toast's shortcut */
const sidebarState = ({
  mac = isMacPlatform(),
}: {
  mac?: boolean;
} = {}): StateCreator<SidebarState> => {
  const prefs = loadSidebarPrefs();
  /** the width the edge drag under way started from */
  let gesture: { width: number } | null = null;

  return (set, get) => {
    const save = () => {
      const { hidden, width, hinted } = get();
      saveSidebarPrefs({ hidden, width, hinted });
    };
    /** the first hide, however it came about, says how to undo it — once per install (D15) */
    const hint = () => {
      if (get().hinted) return;
      set({ hinted: true });
      const keys = shortcutLabel("\\", mac);
      useToastStore.getState().pushToast(`Sidebar hidden · ${keys} to show`, "info", { keys });
    };
    const hide = () => {
      if (get().hidden) return;
      const focusAfter = focusInside(`[${SIDEBAR_REGION}]`) ? "show" : null;
      set({ hidden: true, peek: false, focusAfter });
      hint();
      save();
    };
    const show = () => {
      if (!get().hidden) return;
      const focusAfter = focusInside(`[${SIDEBAR_REGION}], [${SIDEBAR_OPENER}]`) ? "hide" : null;
      set({ hidden: false, peek: false, focusAfter });
      save();
    };
    return {
      ...prefs,
      peek: false,
      resizing: false,
      focusAfter: null,
      hide,
      show,
      toggle: () => (get().hidden ? show() : hide()),
      setWidth: (width) => set({ width: clampSidebarWidth(width) }),
      commitWidth: save,
      openPeek: () => {
        if (get().hidden && !get().peek) set({ peek: true });
      },
      closePeek: () => {
        if (get().peek) set({ peek: false });
      },
      pin: show,
      beginDrag: () => {
        gesture = { width: get().width };
        set({ resizing: true });
      },
      dragTo: (x) => {
        if (!gesture) return;
        // only a docked sidebar has an edge, so hidden here means this gesture hid it
        const next = resolveEdgeDrag(x, get().hidden);
        if (next.hidden) {
          // the width stays where the drag left it visible; hiding is not a width
          if (!get().hidden) set({ hidden: true });
          return;
        }
        set({ hidden: false, width: next.width });
      },
      endDrag: () => {
        const started = gesture;
        gesture = null;
        if (!started) return;
        // a drag that ends hidden was a way to hide, not a choice of width
        set(get().hidden ? { resizing: false, width: started.width } : { resizing: false });
        if (get().hidden) hint();
        save();
      },
      clearFocusAfter: () => set({ focusAfter: null }),
    };
  };
};

/** a store of its own, as a restart would make one — for tests */
export const createSidebarStore = (options: { mac?: boolean } = {}) =>
  createStore<SidebarState>()(sidebarState(options));

/**
 * The app's one sidebar store. A module like this one, re-run by HMR, would
 * split into two stores — restart `tauri dev` after changing it (the
 * store.ts rule).
 */
export const useSidebarStore = create<SidebarState>()(sidebarState());

/** the window's width, live */
export const useViewportWidth = (): number => {
  const [viewport, setViewport] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
};

/** the layout as chosen — the pure functions above make it a width on screen */
const useLayout = (): Layout => ({
  hidden: useSidebarStore((s) => s.hidden),
  width: useSidebarStore((s) => s.width),
});

/** the sidebar's width on screen, docked or peeking (D18) */
export const useVisibleSidebarWidth = (): number =>
  visibleSidebarWidth(
    useSidebarStore((s) => s.width),
    useViewportWidth(),
  );

/** what the docked sidebar takes from the window — 0 while hidden */
export const useDockedWidth = (): number => dockedWidth(useLayout(), useViewportWidth());

/** the window less the docked sidebar, live — what the editor lays itself out in (D24) */
export const useContentWidth = (): number => contentWidth(useLayout(), useViewportWidth());
