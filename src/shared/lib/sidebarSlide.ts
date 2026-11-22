import { create } from "zustand";

import { useSidebarStore, useViewportWidth, useVisibleSidebarWidth } from "./sidebarLayout";

/**
 * The docked sidebar sliding out and in as it hides and shows (canvas
 * `TabsCollapse-Toggle`, hide / show motion). It lives in shared/lib, beside
 * the layout it follows, because the band's tabs, Home's column and the chat
 * panel move or size themselves by it.
 */

/** how long the slide takes */
export const SLIDE_MS = 200;

/** the slide's timing — the tree fold's ease; none under reduced motion */
export const SLIDE_TIMING = "motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.2,0,0,1)]";

/**
 * closed: no slot · entering: drawn at width 0, for one layout · opening: on
 * its way to the sidebar's width · open · closing: on its way to 0
 */
export type SlidePhase = "closed" | "entering" | "opening" | "open" | "closing";

interface SlideState {
  phase: SlidePhase;
  /** drawn at width 0: it may start widening */
  entered: () => void;
  /** the motion has ended (its transition, or the fallback) */
  settle: () => void;
}

/** the slots on screen — with none, there is nothing to slide */
let slots = 0;
/** a transition that never runs ends no later than this */
let fallback: ReturnType<typeof setTimeout> | null = null;

const reducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** moves the slide to `phase`, timing the fallback when it is a motion */
const go = (phase: SlidePhase) => {
  if (fallback) clearTimeout(fallback);
  fallback = null;
  if (phase === "opening" || phase === "closing") {
    fallback = setTimeout(() => useSidebarSlideStore.getState().settle(), SLIDE_MS + 50);
  }
  useSidebarSlideStore.setState({ phase });
};

/** the slide's state. A module like this one, re-run by HMR, splits in two — restart `tauri dev` after changing it */
export const useSidebarSlideStore = create<SlideState>()((_, get) => ({
  phase: useSidebarStore.getState().hidden ? "closed" : "open",
  entered: () => {
    if (get().phase === "entering") go("opening");
  },
  settle: () => {
    const { phase } = get();
    if (phase === "opening") go("open");
    else if (phase === "closing") go("closed");
  },
}));

/**
 * Hiding and showing slide — Hide sidebar, Show sidebar, ⌘\, the peek's Pin.
 * An edge drag (the pointer moves it), reduced motion, and a change with no
 * slot on screen are instant. A toggle mid-slide turns it round from where
 * it is.
 */
useSidebarStore.subscribe((now, before) => {
  if (now.hidden === before.hidden) return;
  const { phase } = useSidebarSlideStore.getState();
  if (slots === 0 || now.resizing || before.resizing || reducedMotion()) {
    go(now.hidden ? "closed" : "open");
  } else if (now.hidden) {
    if (phase !== "closed") go("closing");
  } else if (phase === "closed") {
    go("entering");
  } else if (phase === "closing") {
    go("opening");
  }
});

/** a slot on screen, for as long as it is — returns its leaving */
export const registerSidebarSlot = (): (() => void) => {
  slots += 1;
  return () => {
    slots -= 1;
  };
};

/** the docked sidebar is sliding out or in */
export const isSliding = (phase: SlidePhase): boolean =>
  phase === "entering" || phase === "opening" || phase === "closing";

export const useSidebarSliding = (): boolean => useSidebarSlideStore((s) => isSliding(s.phase));

/**
 * The content's width for what lays itself out in it (the chat panel): the
 * window less the docked sidebar — which, sliding out, still counts until it
 * has gone, so nothing widens before there is room.
 */
export const useContentRoom = (): number => {
  const slotted = useSidebarSlideStore((s) => s.phase !== "closed");
  const sidebar = useVisibleSidebarWidth();
  return useViewportWidth() - (slotted ? sidebar : 0);
};

/** a still slide that matches the sidebar store, for tests */
export const resetSidebarSlideForTests = (): void => {
  go(useSidebarStore.getState().hidden ? "closed" : "open");
};
