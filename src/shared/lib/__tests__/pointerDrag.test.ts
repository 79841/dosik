import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRAG_THRESHOLD_PX, startPointerDrag, usePointerDrag } from "../pointerDrag";

const fakeReactPointerEvent = (x: number, y: number, button = 0) =>
  ({ button, clientX: x, clientY: y }) as React.PointerEvent;

const firePointer = (type: "pointermove" | "pointerup" | "pointercancel", x: number, y: number) => {
  const ev = new Event(type) as PointerEvent & { clientX: number; clientY: number };
  Object.assign(ev, { clientX: x, clientY: y });
  window.dispatchEvent(ev);
};

const identity = (p: { x: number; y: number }) => p;

describe("startPointerDrag", () => {
  it("does not treat a move under the threshold (4px) as a drag (a click passes through as a selection)", () => {
    const onStart = vi.fn();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    startPointerDrag(fakeReactPointerEvent(10, 10), identity, { onStart, onMove, onEnd });

    firePointer("pointermove", 11, 11);
    firePointer("pointerup", 11, 11);

    expect(onStart).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("calls onStart→onMove(delta)→onEnd in order once past the threshold", () => {
    const calls: string[] = [];
    const deltas: { dx: number; dy: number }[] = [];
    startPointerDrag(fakeReactPointerEvent(0, 0), identity, {
      onStart: () => calls.push("start"),
      onMove: (_p, d) => {
        calls.push("move");
        deltas.push(d);
      },
      onEnd: () => calls.push("end"),
    });

    firePointer("pointermove", 10, 0);
    firePointer("pointermove", 20, 5);
    firePointer("pointerup", 20, 5);

    expect(calls).toEqual(["start", "move", "move", "end"]);
    expect(deltas[0]).toEqual({ dx: 10, dy: 0 });
    expect(deltas[1]).toEqual({ dx: 10, dy: 5 });
  });

  it("ignores clicks with a secondary button", () => {
    const onMove = vi.fn();
    startPointerDrag(fakeReactPointerEvent(0, 0, 2), identity, { onMove });
    firePointer("pointermove", 50, 50);
    firePointer("pointerup", 50, 50);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("removes the listeners after pointerup", () => {
    const onMove = vi.fn();
    startPointerDrag(fakeReactPointerEvent(0, 0), identity, { onMove });
    firePointer("pointermove", 10, 0);
    firePointer("pointerup", 10, 0);
    onMove.mockClear();
    firePointer("pointermove", 100, 100);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("keeps the editor's 4px threshold", () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });
});

describe("startPointerDrag — cancel (#221 T29)", () => {
  const pressEscape = () => {
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev;
  };

  it("cancels on Escape (capture) when onCancel is given — removes the listeners, calls only onCancel, swallows Escape", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const onCancel = vi.fn();
    const heard = vi.fn();
    document.body.addEventListener("keydown", heard);
    startPointerDrag(fakeReactPointerEvent(0, 0), identity, { onMove, onEnd, onCancel });
    firePointer("pointermove", 10, 0);
    const esc = pressEscape();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    onMove.mockClear();
    firePointer("pointermove", 30, 0);
    firePointer("pointerup", 30, 0);
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", heard);
  });

  it("also cancels on pointercancel and window blur", () => {
    for (const cancel of [
      () => firePointer("pointercancel", 10, 0),
      () => window.dispatchEvent(new Event("blur")),
    ]) {
      const onEnd = vi.fn();
      const onCancel = vi.fn();
      startPointerDrag(fakeReactPointerEvent(0, 0), identity, { onMove: vi.fn(), onEnd, onCancel });
      firePointer("pointermove", 10, 0);
      cancel();
      firePointer("pointerup", 10, 0);
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onEnd).not.toHaveBeenCalled();
    }
  });

  it("a cancel before the start (under 4px) fires no callback and does not swallow Escape", () => {
    const onCancel = vi.fn();
    const onMove = vi.fn();
    startPointerDrag(fakeReactPointerEvent(0, 0), identity, { onMove, onCancel });
    firePointer("pointermove", 1, 1);
    const esc = pressEscape();
    expect(esc.defaultPrevented).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
    // and the drag is over: moving on starts nothing
    firePointer("pointermove", 40, 40);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not listen to those events without onCancel — the editor behaves as before", () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    startPointerDrag(fakeReactPointerEvent(0, 0), identity, { onMove, onEnd });
    firePointer("pointermove", 10, 0);
    const esc = pressEscape();
    window.dispatchEvent(new Event("blur"));
    expect(esc.defaultPrevented).toBe(false);
    firePointer("pointermove", 20, 0);
    firePointer("pointerup", 20, 0);
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("accepts another button through buttons — the board's middle-button pan", () => {
    const onMove = vi.fn();
    startPointerDrag(fakeReactPointerEvent(0, 0, 1), identity, { onMove }, { buttons: [0, 1] });
    firePointer("pointermove", 10, 0);
    firePointer("pointerup", 10, 0);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("the returned function stops the drag — removes only the listeners, no callbacks", () => {
    const onMove = vi.fn();
    const onCancel = vi.fn();
    const stop = startPointerDrag(fakeReactPointerEvent(0, 0), identity, { onMove, onCancel });
    firePointer("pointermove", 10, 0);
    stop();
    firePointer("pointermove", 20, 0);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("usePointerDrag — the drag ends when its owner unmounts (#221)", () => {
  afterEach(() => vi.restoreAllMocks());

  const handlers = () => ({
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
  });

  it("unmounting mid-drag removes every window listener and calls onCancel — later moves and releases are ignored", () => {
    const { result, unmount } = renderHook(() => usePointerDrag());
    const h = handlers();
    result.current(fakeReactPointerEvent(0, 0), identity, h);
    firePointer("pointermove", 10, 0);
    expect(h.onMove).toHaveBeenCalledTimes(1);
    const removed = vi.spyOn(window, "removeEventListener");
    unmount();
    const types = removed.mock.calls.map(([type]) => type);
    expect(types).toEqual(
      expect.arrayContaining(["pointermove", "pointerup", "pointercancel", "blur", "keydown"]),
    );
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    firePointer("pointermove", 40, 0);
    firePointer("pointerup", 40, 0);
    expect(h.onMove).toHaveBeenCalledTimes(1);
    expect(h.onEnd).not.toHaveBeenCalled();
  });

  it("unmounting before the threshold removes only the listeners — a drag that never started gets no onCancel", () => {
    const { result, unmount } = renderHook(() => usePointerDrag());
    const h = handlers();
    result.current(fakeReactPointerEvent(0, 0), identity, h);
    unmount();
    firePointer("pointermove", 40, 0);
    firePointer("pointerup", 40, 0);
    expect(h.onStart).not.toHaveBeenCalled();
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("unmounting after a finished drag does nothing", () => {
    const { result, unmount } = renderHook(() => usePointerDrag());
    const h = handlers();
    result.current(fakeReactPointerEvent(0, 0), identity, h);
    firePointer("pointermove", 10, 0);
    firePointer("pointerup", 10, 0);
    unmount();
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("a new press drops the previous drag — the two never listen together", () => {
    const { result, unmount } = renderHook(() => usePointerDrag());
    const first = handlers();
    const second = handlers();
    result.current(fakeReactPointerEvent(0, 0), identity, first);
    firePointer("pointermove", 10, 0);
    result.current(fakeReactPointerEvent(0, 0), identity, second);
    expect(first.onCancel).toHaveBeenCalledTimes(1);
    firePointer("pointermove", 20, 0);
    expect(first.onMove).toHaveBeenCalledTimes(1);
    expect(second.onMove).toHaveBeenCalledTimes(1);
    unmount();
    expect(second.onCancel).toHaveBeenCalledTimes(1);
  });

  it("the returned function drops it too — with onCancel if the drag had started", () => {
    const { result } = renderHook(() => usePointerDrag());
    const h = handlers();
    const drop = result.current(fakeReactPointerEvent(0, 0), identity, h);
    firePointer("pointermove", 10, 0);
    drop();
    drop();
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    firePointer("pointermove", 30, 0);
    expect(h.onMove).toHaveBeenCalledTimes(1);
  });
});
