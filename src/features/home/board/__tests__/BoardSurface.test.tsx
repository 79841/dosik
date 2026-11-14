import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardSurface } from "../BoardSurface";
import { resetBoardForTests, useBoardStore } from "../boardStore";

const frames: FrameRequestCallback[] = [];
const runFrame = () =>
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });
const viewport = () => useBoardStore.getState().viewport!;

const show = () =>
  render(
    <BoardSurface>
      <div data-board-item="" data-testid="card" />
      <div data-testid="body" />
    </BoardSurface>,
  );
const surface = () => document.querySelector<HTMLElement>("[data-board-surface]")!;
const layer = () => document.querySelector<HTMLElement>("[data-board-layer]")!;

const wheel = (init: WheelEventInit) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  act(() => {
    surface().dispatchEvent(event);
  });
  return event;
};

describe("board surface (#221 D3·D10·D19, T36)", () => {
  beforeEach(() => {
    resetBoardForTests();
    useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 });
    frames.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("the viewport becomes a single transform layer — translate + scale", () => {
    useBoardStore.getState().setViewport({ x: 30, y: -20, zoom: 0.7 });
    show();
    expect(layer().style.transform).toBe("translate(30px, -20px) scale(0.7)");
  });

  it("the wheel is non-passive and blocked, applied once per rAF", () => {
    show();
    const first = wheel({ deltaY: 20 });
    wheel({ deltaY: 20 });
    expect(first.defaultPrevented).toBe(true);
    expect(viewport()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(frames).toHaveLength(1);
    runFrame();
    expect(viewport()).toEqual({ x: 0, y: -20, zoom: 1 });
  });

  it("pinch (ctrlKey wheel)·⌘+wheel zooms", () => {
    show();
    wheel({ deltaY: -10, ctrlKey: true });
    runFrame();
    expect(viewport().zoom).toBeGreaterThan(1);
    const before = viewport().zoom;
    wheel({ deltaY: -10, metaKey: true });
    runFrame();
    expect(viewport().zoom).toBeGreaterThan(before);
  });

  it("dragging empty space·a frame body pans, starting on a card does not pan", () => {
    show();
    fireEvent.pointerDown(screen.getByTestId("body"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 30 });
    expect(viewport()).toEqual({ x: 30, y: 20, zoom: 1 });
    fireEvent.pointerDown(screen.getByTestId("card"), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
    expect(viewport()).toEqual({ x: 30, y: 20, zoom: 1 });
  });

  it("panning ends when the window loses focus or on pointercancel — leftover listeners do not drag the board (#221)", () => {
    show();
    const pan = () => {
      fireEvent.pointerDown(screen.getByTestId("body"), { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
    };
    pan();
    expect(viewport()).toEqual({ x: 30, y: 20, zoom: 1 });
    // the pointerup went to another window
    fireEvent.blur(window);
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    expect(viewport()).toEqual({ x: 30, y: 20, zoom: 1 });
    pan();
    expect(viewport()).toEqual({ x: 60, y: 40, zoom: 1 });
    fireEvent.pointerCancel(window);
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    expect(viewport()).toEqual({ x: 60, y: 40, zoom: 1 });
  });

  it("removes listeners if the surface unmounts mid-pan", () => {
    const view = show();
    fireEvent.pointerDown(screen.getByTestId("body"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
    view.unmount();
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    expect(viewport()).toEqual({ x: 30, y: 20, zoom: 1 });
  });

  it("the middle button pans anywhere — even over a card", () => {
    show();
    fireEvent.pointerDown(screen.getByTestId("card"), { button: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 0 });
    expect(viewport().x).toBe(10);
  });

  describe("trackpad pinch — WebKit GestureEvent (#236, being verified)", () => {
    /** WebKit's GestureEvent: `scale` from 1 at gesturestart, the pointer in client space */
    const gesture = (
      type: string,
      init: { scale?: number; clientX?: number; clientY?: number } = {},
    ) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), init);
      act(() => {
        surface().dispatchEvent(event);
      });
      return event;
    };

    it("all three events block the default action (page zoom)", () => {
      show();
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        expect(gesture(type, { scale: 1, clientX: 0, clientY: 0 }).defaultPrevented).toBe(true);
      }
    });

    it("zooms in·out around the pointer by scale — start zoom × scale, once per rAF", () => {
      show();
      gesture("gesturestart", { scale: 1, clientX: 100, clientY: 50 });
      gesture("gesturechange", { scale: 1.5, clientX: 100, clientY: 50 });
      gesture("gesturechange", { scale: 2, clientX: 100, clientY: 50 });
      expect(frames).toHaveLength(1);
      runFrame();
      // the board point under the pointer stays under it: (100, 50) at zoom 1 is board (100, 50)
      expect(viewport()).toEqual({ x: -100, y: -50, zoom: 2 });
      gesture("gesturechange", { scale: 0.5, clientX: 100, clientY: 50 });
      runFrame();
      expect(viewport().zoom).toBe(0.5);
      gesture("gestureend", { scale: 0.5, clientX: 100, clientY: 50 });
    });

    it("the last gesturechange applies on the next frame even if gestureend arrives first", () => {
      show();
      gesture("gesturestart", { scale: 1, clientX: 0, clientY: 0 });
      gesture("gesturechange", { scale: 1.5, clientX: 0, clientY: 0 });
      gesture("gestureend", { scale: 1.5, clientX: 0, clientY: 0 });
      runFrame();
      expect(viewport().zoom).toBe(1.5);
    });

    it("ignores a gesturechange that arrives without gesturestart", () => {
      show();
      gesture("gesturechange", { scale: 2, clientX: 0, clientY: 0 });
      runFrame();
      expect(viewport().zoom).toBe(1);
    });

    it("does not exceed the range (20%–200%)", () => {
      show();
      gesture("gesturestart", { scale: 1, clientX: 0, clientY: 0 });
      gesture("gesturechange", { scale: 10, clientX: 0, clientY: 0 });
      runFrame();
      expect(viewport().zoom).toBe(2);
      gesture("gesturechange", { scale: 0.01, clientX: 0, clientY: 0 });
      runFrame();
      expect(viewport().zoom).toBe(0.2);
    });

    it("zooms around the board center when there are no pointer coordinates", () => {
      show();
      surface().getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
      gesture("gesturestart", { scale: 1 });
      gesture("gesturechange", { scale: 2 });
      runFrame();
      expect(viewport()).toEqual({ x: -200, y: -100, zoom: 2 });
    });

    it("ctrl-wheel arriving during a pinch is not counted (no double zoom) — ctrl-wheel zooms again after it ends", () => {
      show();
      gesture("gesturestart", { scale: 1, clientX: 0, clientY: 0 });
      const during = wheel({ deltaY: -10, ctrlKey: true });
      expect(during.defaultPrevented).toBe(true);
      runFrame();
      expect(viewport().zoom).toBe(1);
      gesture("gestureend", { scale: 1, clientX: 0, clientY: 0 });
      wheel({ deltaY: -10, ctrlKey: true });
      runFrame();
      expect(viewport().zoom).toBeGreaterThan(1);
    });

    it("losing window focus without gestureend counts as the pinch ending — ctrl-wheel zooms again", () => {
      show();
      gesture("gesturestart", { scale: 1, clientX: 0, clientY: 0 });
      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      wheel({ deltaY: -10, ctrlKey: true });
      runFrame();
      expect(viewport().zoom).toBeGreaterThan(1);
    });

    it("two-finger pan (wheel without ctrl) still pans during a pinch", () => {
      show();
      gesture("gesturestart", { scale: 1, clientX: 0, clientY: 0 });
      wheel({ deltaY: 20 });
      runFrame();
      expect(viewport()).toEqual({ x: 0, y: -10, zoom: 1 });
    });
  });

  it("will-change only while moving — removed 150ms after it stops", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    show();
    expect(layer()).not.toHaveClass("will-change-transform");
    wheel({ deltaY: 10 });
    runFrame();
    expect(layer()).toHaveClass("will-change-transform");
    act(() => vi.advanceTimersByTime(149));
    expect(layer()).toHaveClass("will-change-transform");
    act(() => vi.advanceTimersByTime(1));
    expect(layer()).not.toHaveClass("will-change-transform");
  });

  it("transitions (motion-safe) only for programmatic moves", () => {
    show();
    expect(layer().className).not.toContain("transition-transform");
    act(() => useBoardStore.getState().focusCamera({ x: 5, y: 5, zoom: 1 }));
    expect(layer().className).toContain("motion-safe:transition-transform");
  });

  it("resets to 0 right away when scrolled — a safety net for WebKit (below 16) without overflow: clip (#221)", () => {
    show();
    // clip where it is known; elsewhere a box of its own (never the sheet's scroll)
    expect(surface()).toHaveClass("overflow-hidden", "supports-[overflow:clip]:overflow-clip");
    surface().scrollLeft = 40;
    surface().scrollTop = 30;
    fireEvent.scroll(surface());
    expect(surface().scrollLeft).toBe(0);
    expect(surface().scrollTop).toBe(0);
  });

  it("hides the dot grid below 40%", () => {
    show();
    expect(surface().className).toContain("radial-gradient");
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 0.35 }));
    expect(surface().className).not.toContain("radial-gradient");
  });

  it("right click on empty space calls onEmptyContextMenu (screen point) — not over a card", () => {
    const onEmptyContextMenu = vi.fn();
    render(
      <BoardSurface onEmptyContextMenu={onEmptyContextMenu}>
        <div data-board-item="" data-testid="card" />
        <div data-testid="body" />
      </BoardSurface>,
    );
    fireEvent.contextMenu(screen.getByTestId("card"), { clientX: 5, clientY: 5 });
    expect(onEmptyContextMenu).not.toHaveBeenCalled();
    const event = fireEvent.contextMenu(screen.getByTestId("body"), { clientX: 50, clientY: 60 });
    expect(event).toBe(false);
    expect(onEmptyContextMenu).toHaveBeenCalledWith({ x: 50, y: 60 });
  });
});
