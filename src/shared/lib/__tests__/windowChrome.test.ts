import { describe, expect, it } from "vitest";

import { isMacContextClick, isOnDragRegion } from "../windowChrome";

/** builds markup and returns the element marked `data-t` */
const at = (html: string): HTMLElement => {
  document.body.innerHTML = html;
  return document.querySelector("[data-t]") as HTMLElement;
};

describe("isOnDragRegion — Tauri's own rule for what drags the window (drag.js)", () => {
  it("a plain place inside a deep region drags", () => {
    expect(
      isOnDragRegion(at('<div data-tauri-drag-region="deep"><span data-t></span></div>')),
    ).toBe(true);
  });

  it("a clickable thing inside it does not — a button, a tab, a focusable box", () => {
    expect(
      isOnDragRegion(
        at('<div data-tauri-drag-region="deep"><button><i data-t></i></button></div>'),
      ),
    ).toBe(false);
    expect(
      isOnDragRegion(at('<div data-tauri-drag-region="deep"><div role="tab" data-t></div></div>')),
    ).toBe(false);
    expect(
      isOnDragRegion(
        at('<div data-tauri-drag-region="deep"><div tabindex="0" data-t></div></div>'),
      ),
    ).toBe(false);
    expect(
      isOnDragRegion(
        at('<div data-tauri-drag-region="deep"><div contenteditable="true" data-t></div></div>'),
      ),
    ).toBe(false);
  });

  it("tabindex -1 and contenteditable false are not clickable — they still drag", () => {
    expect(
      isOnDragRegion(
        at('<div data-tauri-drag-region="deep"><div tabindex="-1" data-t></div></div>'),
      ),
    ).toBe(true);
    expect(
      isOnDragRegion(
        at('<div data-tauri-drag-region="deep"><div contenteditable="false" data-t></div></div>'),
      ),
    ).toBe(true);
  });

  it('"false" stops it; a bare region drags only from itself', () => {
    expect(
      isOnDragRegion(
        at(
          '<div data-tauri-drag-region="deep"><div data-tauri-drag-region="false"><b data-t></b></div></div>',
        ),
      ),
    ).toBe(false);
    expect(isOnDragRegion(at("<div data-tauri-drag-region data-t></div>"))).toBe(true);
    expect(isOnDragRegion(at("<div data-tauri-drag-region><b data-t></b></div>"))).toBe(false);
  });

  it("outside any region, or no element at all: no drag", () => {
    expect(isOnDragRegion(at("<div><span data-t></span></div>"))).toBe(false);
    expect(isOnDragRegion(null)).toBe(false);
  });
});

describe("isMacContextClick", () => {
  it("a ctrl+click is the right click on macOS only", () => {
    expect(isMacContextClick({ ctrlKey: true }, true)).toBe(true);
    expect(isMacContextClick({ ctrlKey: true }, false)).toBe(false);
    expect(isMacContextClick({ ctrlKey: false }, true)).toBe(false);
  });
});
