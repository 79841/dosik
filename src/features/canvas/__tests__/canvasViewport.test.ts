import { afterEach, describe, expect, it } from "vitest";

import {
  currentViewport,
  pastePoint,
  registerPointerAt,
  registerViewportCenter,
  registerViewportRead,
} from "../canvasViewport";

describe("pastePoint — where ⌘V places things (#200)", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("is the mouse position when the mouse is over the canvas", () => {
    cleanups.push(registerViewportCenter(() => ({ x: 500, y: 400 })));
    cleanups.push(registerPointerAt(() => ({ x: 120, y: 80 })));
    expect(pastePoint()).toEqual({ x: 120, y: 80 });
  });

  it("is the screen center when off the canvas", () => {
    cleanups.push(registerViewportCenter(() => ({ x: 500, y: 400 })));
    cleanups.push(registerPointerAt(() => null));
    expect(pastePoint()).toEqual({ x: 500, y: 400 });
  });

  it("is the origin without a canvas — unregistering goes back to it", () => {
    const off = registerPointerAt(() => ({ x: 1, y: 2 }));
    off();
    expect(pastePoint()).toEqual({ x: 0, y: 0 });
  });
});

describe("currentViewport — the viewport read when leaving a tab (#218 D5, T8)", () => {
  it("is null without a canvas", () => {
    expect(currentViewport()).toBeNull();
  });

  it("returns the registered value, and unregistering removes only its own", () => {
    const first = registerViewportRead(() => ({ x: 1, y: 2, zoom: 3 }));
    expect(currentViewport()).toEqual({ x: 1, y: 2, zoom: 3 });
    // a remount registers before the old one's cleanup runs
    const second = registerViewportRead(() => ({ x: 4, y: 5, zoom: 0.5 }));
    first();
    expect(currentViewport()).toEqual({ x: 4, y: 5, zoom: 0.5 });
    second();
    expect(currentViewport()).toBeNull();
  });
});
