import { useCallback, useEffect, useRef } from "react";

import type { Point } from "./edgeGeometry";

export const DRAG_THRESHOLD_PX = 4;

export interface PointerDragHandlers {
  onStart?: (p: Point) => void;
  onMove: (p: Point, delta: { dx: number; dy: number }) => void;
  onEnd?: (p: Point) => void;
  /**
   * The drag was called off once it had started — Escape, `pointercancel`,
   * the window losing focus (#221 D13). Only a caller that passes this hears
   * those; one that does not (the editor) behaves as before.
   */
  onCancel?: () => void;
}

/**
 * Pointer-drag with a movement threshold: plain clicks fall through (React
 * Flow's selection, a board card's focus), real drags run the callbacks.
 * Coordinates are converted via `toFlow`. `buttons` says which buttons start
 * one — the primary alone unless told (the Home canvas pans with the middle
 * one too). Returns a function that drops the drag without a word.
 *
 * Shared by the editor's canvas and the Home canvas (#221 D21), so the two
 * tell a click from a drag alike.
 */
export const startPointerDrag = (
  e: React.PointerEvent,
  toFlow: (client: { x: number; y: number }) => Point,
  handlers: PointerDragHandlers,
  { buttons = [0] }: { buttons?: number[] } = {},
): (() => void) => {
  if (!buttons.includes(e.button)) return () => undefined;
  const startClient = { x: e.clientX, y: e.clientY };
  let started = false;
  let last = toFlow(startClient);
  const cancellable = handlers.onCancel !== undefined;

  const move = (ev: PointerEvent): void => {
    const p = toFlow({ x: ev.clientX, y: ev.clientY });
    if (!started) {
      if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) < DRAG_THRESHOLD_PX) {
        return;
      }
      started = true;
      handlers.onStart?.(last);
    }
    handlers.onMove(p, { dx: p.x - last.x, dy: p.y - last.y });
    last = p;
  };
  const up = (ev: PointerEvent): void => {
    stop();
    if (started) {
      handlers.onEnd?.(toFlow({ x: ev.clientX, y: ev.clientY }));
    }
  };
  const cancel = (): void => {
    stop();
    if (started) handlers.onCancel?.();
  };
  const onEscape = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    // a drag under way takes this Escape — nothing behind it (leaving a
    // focus, closing a view) should act on it too
    if (started) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    cancel();
  };
  const stop = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (cancellable) {
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onEscape, true);
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  if (cancellable) {
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onEscape, true);
  }
  return stop;
};

/**
 * `startPointerDrag` for a component that can go away mid-drag — a board
 * card or frame a fresh listing, a delete or a view switch takes off the
 * screen (#221). The drag under way is dropped when the component
 * unmounts: its window listeners go, and a drag that had started hears
 * `onCancel`, so whatever it hooked up or showed is put back. A new press
 * drops the last drag first. The returned start function returns a drop of
 * its own, which does the same.
 */
export const usePointerDrag = (): typeof startPointerDrag => {
  /** drops the drag under way — nothing once it is over */
  const drop = useRef<() => void>(() => undefined);
  useEffect(() => () => drop.current(), []);
  return useCallback((e, toFlow, handlers, options) => {
    drop.current();
    let started = false;
    let over = false;
    const stop = startPointerDrag(
      e,
      toFlow,
      {
        ...handlers,
        onStart: (p) => {
          started = true;
          handlers.onStart?.(p);
        },
        onEnd: (p) => {
          over = true;
          handlers.onEnd?.(p);
        },
        onCancel:
          handlers.onCancel &&
          (() => {
            over = true;
            handlers.onCancel?.();
          }),
      },
      options,
    );
    const dropThis = (): void => {
      if (over) return;
      over = true;
      stop();
      if (started) handlers.onCancel?.();
    };
    drop.current = dropThis;
    return dropThis;
  }, []);
};
