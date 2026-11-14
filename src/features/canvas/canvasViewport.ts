import type { Viewport } from "@xyflow/react";

/**
 * Where the canvas is, for code that runs outside React (#8) — the keymap
 * pastes a picture "in the middle of what you are looking at", and only the
 * mounted canvas knows that. It registers itself here; before it does, the
 * origin stands in.
 */
type CenterFn = () => { x: number; y: number };

let center: CenterFn = () => ({ x: 0, y: 0 });

export const registerViewportCenter = (fn: CenterFn): (() => void) => {
  center = fn;
  return () => {
    if (center === fn) center = () => ({ x: 0, y: 0 });
  };
};

/** the centre of the visible canvas, in flow coordinates */
export const viewportCenter = (): { x: number; y: number } => center();

/**
 * Where the pointer is over the canvas, in flow coordinates — null when it is
 * off the canvas (a panel, the toolbar, outside the window). Registered by the
 * mounted canvas, like the centre.
 */
type PointerFn = () => { x: number; y: number } | null;

let pointerAt: PointerFn = () => null;

export const registerPointerAt = (fn: PointerFn): (() => void) => {
  pointerAt = fn;
  return () => {
    if (pointerAt === fn) pointerAt = () => null;
  };
};

/**
 * Where ⌘V puts what it pastes from the system clipboard — a picture or a
 * Mermaid diagram (#200): under the pointer, the way the user aims it, and
 * the middle of the view when the pointer is not over the canvas.
 */
export const pastePoint = (): { x: number; y: number } => pointerAt() ?? center();

/**
 * The canvas's pan and zoom, read when a tab is left so it can be put back
 * (#218 D5). Registered by the mounted canvas; null while none is (Home).
 */
type ViewportFn = () => Viewport;

let viewportRead: ViewportFn | null = null;

export const registerViewportRead = (fn: ViewportFn): (() => void) => {
  viewportRead = fn;
  return () => {
    if (viewportRead === fn) viewportRead = null;
  };
};

export const currentViewport = (): Viewport | null => viewportRead?.() ?? null;
