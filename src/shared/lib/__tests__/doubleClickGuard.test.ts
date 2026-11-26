import { afterEach, describe, expect, it, vi } from "vitest";

import { clickOpens, swallowRestOfDoubleClick } from "../doubleClickGuard";

const press = (target: EventTarget, type: string, detail: number) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, detail });
  target.dispatchEvent(e);
  return e;
};

describe("the rest of a double click on the screen its first click opened", () => {
  let el: HTMLElement;
  const seen = vi.fn();
  const watch = () => {
    el = document.createElement("div");
    document.body.append(el);
    for (const t of ["mousedown", "mouseup", "click", "dblclick"]) el.addEventListener(t, seen);
  };
  afterEach(() => {
    el?.remove();
    seen.mockReset();
    vi.useRealTimers();
  });

  it("swallows the second press, its click and the dblclick — nothing under them hears them", () => {
    watch();
    swallowRestOfDoubleClick();
    const down = press(el, "mousedown", 2);
    press(el, "mouseup", 2);
    press(el, "click", 2);
    const dbl = press(el, "dblclick", 2);
    expect(seen).not.toHaveBeenCalled();
    // no text selection by the double click, no zoom on a canvas
    expect(down.defaultPrevented).toBe(true);
    expect(dbl.defaultPrevented).toBe(true);
  });

  it("a new click (detail 1) ends it and goes through, and so does what follows", () => {
    watch();
    swallowRestOfDoubleClick();
    press(el, "mousedown", 1);
    press(el, "click", 2);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("ends by itself after the double-click time", () => {
    vi.useFakeTimers();
    watch();
    swallowRestOfDoubleClick();
    vi.advanceTimersByTime(1000);
    press(el, "click", 2);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("arming again replaces the guard — one set of listeners", () => {
    watch();
    swallowRestOfDoubleClick();
    swallowRestOfDoubleClick();
    press(el, "mousedown", 1);
    press(el, "click", 2);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe("clickOpens — whether a click opens, and the guard for a mouse's", () => {
  afterEach(() => press(document.body, "mousedown", 1));

  it("a mouse click (detail 1) opens and arms the guard", () => {
    expect(clickOpens({ detail: 1 })).toBe(true);
    const seen = vi.fn();
    document.body.addEventListener("click", seen);
    press(document.body, "click", 2);
    expect(seen).not.toHaveBeenCalled();
    document.body.removeEventListener("click", seen);
  });

  it("a keyboard click (detail 0) opens without arming it", () => {
    expect(clickOpens({ detail: 0 })).toBe(true);
    const seen = vi.fn();
    document.body.addEventListener("click", seen);
    press(document.body, "click", 2);
    expect(seen).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("click", seen);
  });

  it("a double click's later clicks open nothing", () => {
    expect(clickOpens({ detail: 2 })).toBe(false);
    expect(clickOpens({ detail: 3 })).toBe(false);
  });
});
