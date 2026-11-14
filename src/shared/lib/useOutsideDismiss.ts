import { useEffect, useRef, type RefObject } from "react";

/**
 * Dismisses a popup when the pointer goes down outside `ref`, or on Escape.
 * The pointer listener runs in the capture phase: the canvas pan/drag
 * handlers stop propagation of pointer/mouse events, so a bubble listener
 * would never hear canvas clicks (#80). Every popup must share this hook —
 * the bug recurred precisely because the pattern was hand-copied per menu.
 *
 * A popup whose `ref` holds its opener too (the toolbar's menus) needs
 * nothing more. One drawn apart from it (a menu at a point) passes the opener
 * as `ignore`: a pointer going down there is not outside — the opener's own
 * click toggles the popup shut, where dismissing first let that click open
 * it again (#220).
 */
export const useOutsideDismiss = (
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
  {
    ignore,
  }: {
    /** not outside — the opener, or several (a menu's opener and its open picker) */
    ignore?: RefObject<HTMLElement | null> | readonly (RefObject<HTMLElement | null> | undefined)[];
  } = {},
): void => {
  // latest-ref: callers pass inline closures — re-registering listeners on
  // every render would be noise, and a stale closure would dismiss stale state
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  // the same for what is not outside: an inline array is new on every render,
  // and its refs are read only when a press comes (#229)
  const spared = useRef(ignore);
  spared.current = ignore;

  useEffect(() => {
    if (!active) return;
    const down = (e: PointerEvent): void => {
      const target = e.target as Node;
      const ignored = spared.current;
      const others = Array.isArray(ignored) ? ignored : [ignored];
      if (ref.current?.contains(target) || others.some((o) => o?.current?.contains(target))) return;
      dismiss.current();
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") dismiss.current();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", esc);
    };
  }, [ref, active]);
};
