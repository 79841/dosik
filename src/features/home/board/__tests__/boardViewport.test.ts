import { describe, expect, it } from "vitest";

import {
  applyWheel,
  clampZoom,
  DEFAULT_ZOOM,
  FIT_TOP,
  FOCUS_PAD,
  fitRect,
  focusViewport,
  INSETS,
  initialViewport,
  MAX_ZOOM,
  MIN_ZOOM,
  revealPan,
  stepZoom,
  toScreen,
  toWorld,
  type Viewport,
  zoomAt,
} from "../boardViewport";

const vp = (x: number, y: number, zoom: number): Viewport => ({ x, y, zoom });
const size = { width: 1000, height: 800 };
const wheel = (over: Partial<Parameters<typeof applyWheel>[1]> = {}) => ({
  x: 500,
  y: 400,
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe("zoom (#221 D10, T16)", () => {
  it("clampZoom is 20%–200%", () => {
    expect([MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM]).toEqual([0.2, 2, 0.7]);
    expect(clampZoom(0.05)).toBe(0.2);
    expect(clampZoom(5)).toBe(2);
    expect(clampZoom(0.7)).toBe(0.7);
  });

  it("zoomAt keeps that point fixed on screen", () => {
    const before = vp(30, -40, 0.7);
    const p = { x: 420, y: 310 };
    const board = toWorld(before, p);
    const after = zoomAt(before, p, 1.3);
    expect(after.zoom).toBe(1.3);
    const back = toScreen(after, board);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it("stepZoom is ×1.2 (center fixed), stopping at the bounds", () => {
    const next = stepZoom(vp(0, 0, 1), size, 1);
    expect(next.zoom).toBeCloseTo(1.2);
    const centre = toWorld(vp(0, 0, 1), { x: 500, y: 400 });
    expect(toScreen(next, centre).x).toBeCloseTo(500);
    expect(stepZoom(vp(0, 0, 1.9), size, 1).zoom).toBe(2);
    expect(stepZoom(vp(0, 0, 0.21), size, -1).zoom).toBe(0.2);
  });
});

describe("wheel — same constants as React Flow (@xyflow/system 0.0.82) (#221 D10, T17)", () => {
  it("two-finger·wheel pans: screen delta = delta × 0.5", () => {
    expect(applyWheel(vp(0, 0, 0.7), wheel({ deltaX: 10, deltaY: 20 }), true)).toEqual(
      vp(-5, -10, 0.7),
    );
  });

  it("×20 with deltaMode 1 (lines)", () => {
    expect(applyWheel(vp(0, 0, 1), wheel({ deltaY: 3, deltaMode: 1 }), true)).toEqual(
      vp(0, -30, 1),
    );
  });

  it("Shift+wheel is horizontal outside macOS", () => {
    expect(applyWheel(vp(0, 0, 1), wheel({ deltaY: 20, shiftKey: true }), false)).toEqual(
      vp(-10, 0, 1),
    );
    expect(applyWheel(vp(0, 0, 1), wheel({ deltaY: 20, shiftKey: true }), true)).toEqual(
      vp(0, -10, 1),
    );
  });

  it("pinch (ctrlKey wheel) is 2^(−deltaY × 0.002 × 10) around the pointer — ×10 on macOS", () => {
    const mac = applyWheel(vp(0, 0, 1), wheel({ deltaY: -10, ctrlKey: true }), true);
    expect(mac.zoom).toBeCloseTo(2 ** (10 * 0.002 * 10));
    const other = applyWheel(vp(0, 0, 1), wheel({ deltaY: -10, ctrlKey: true }), false);
    expect(other.zoom).toBeCloseTo(2 ** (10 * 0.002));
    // the pointer stays on the same board point
    const p = { x: 500, y: 400 };
    expect(toScreen(mac, toWorld(vp(0, 0, 1), p)).x).toBeCloseTo(500);
  });

  it("deltaMode 1 is 0.05, 2 is 1", () => {
    expect(
      applyWheel(vp(0, 0, 1), wheel({ deltaY: -2, deltaMode: 1, ctrlKey: true }), false).zoom,
    ).toBeCloseTo(2 ** (2 * 0.05));
    expect(
      applyWheel(vp(0, 0, 1), wheel({ deltaY: -0.5, deltaMode: 2, ctrlKey: true }), false).zoom,
    ).toBeCloseTo(2 ** 0.5);
  });

  it("⌘+wheel zooms around the pointer — no ×10", () => {
    const next = applyWheel(vp(0, 0, 1), wheel({ deltaY: -10, metaKey: true }), true);
    expect(next.zoom).toBeCloseTo(2 ** (10 * 0.002));
  });

  it("zoom stops within the range", () => {
    expect(applyWheel(vp(0, 0, 2), wheel({ deltaY: -500, ctrlKey: true }), true).zoom).toBe(2);
  });
});

describe("fit and initial view (#221 D10, T18)", () => {
  it("margins — top 24 (the top island is gone, same as the sides), bottom 60 is the bottom island's slot (#231 D12, T24)", () => {
    expect(INSETS).toEqual({ top: 24, bottom: 60, left: 24, right: 24 });
  });

  it("fit hangs from the top — the canvas frame positions: library top frame 36 (Hybrid-Home-Canvas), focused frame 48 (Hybrid-Folder-Canvas) (#231 D12)", () => {
    expect(FIT_TOP).toEqual({ board: 36, focus: 48 });
    expect(FOCUS_PAD).toBe(48);
  });

  it("fitRect: fits the area minus the island slots, centered horizontally, top at top when shorter than the area — min·max zoom", () => {
    const area = { w: 1000 - 48, h: 800 - 84 };
    const fit = fitRect({ x: 0, y: 0, w: 2000, h: 1000 }, size, { min: 0.2, max: 1, top: 36 });
    expect(fit.zoom).toBeCloseTo(area.w / 2000);
    const left = toScreen(fit, { x: 0, y: 0 });
    expect(left.x).toBeCloseTo(INSETS.left);
    // 476 high in a 716 area: hung 36 below the board's top, not centred
    expect(left.y).toBeCloseTo(36);
    expect(left.y).not.toBeCloseTo(INSETS.top + (area.h - 1000 * fit.zoom) / 2);
    const fits = (w: number, h: number) =>
      fitRect({ x: 0, y: 0, w, h }, size, { min: 0.2, max: 1, top: 36 }).zoom;
    expect(fits(100, 100)).toBe(1);
    expect(fits(100_000, 100)).toBe(0.2);
  });

  it("fitRect: zoom unchanged — fits content plus pad on all sides into the area. Hanging uses the top of the content without pad", () => {
    const rect = { x: 100, y: 200, w: 600, h: 400 };
    const fit = fitRect(rect, size, { min: 0.2, max: 2, pad: 48, top: 48 });
    // the zoom the padded box gave before (#221 D11·D12): 952 / 696
    expect(fit.zoom).toBeCloseTo(Math.min((1000 - 48) / 696, (800 - 84) / 496));
    const corner = toScreen(fit, rect);
    expect(corner.y).toBeCloseTo(48);
    // across, centred as before
    expect(corner.x + (rect.w * fit.zoom) / 2).toBeCloseTo(INSETS.left + (1000 - 48) / 2);
  });

  it("fitRect: if hanging overflows the bottom of the area, raises it just enough, and if even the smallest is larger than the area, top of the area", () => {
    // 710 high at 100%: 36 + 710 would pass the area's bottom (800 − 60) — it ends there instead
    const tall = fitRect({ x: 0, y: 0, w: 100, h: 710 }, size, { min: 1, max: 1, top: 36 });
    expect(toScreen(tall, { x: 0, y: 710 }).y).toBeCloseTo(800 - 60);
    expect(toScreen(tall, { x: 0, y: 0 }).y).toBeCloseTo(30);
    // taller than the area even at the least zoom: its top lines up with the area's
    const over = fitRect({ x: 0, y: 0, w: 100, h: 100_000 }, size, { min: 0.2, max: 1, top: 36 });
    expect(toScreen(over, { x: 0, y: 0 }).y).toBeCloseTo(INSETS.top);
  });

  it("initialViewport: a small board at 70%, centered horizontally, the top 36 from the top of the board view (Hybrid-Home-Canvas)", () => {
    const start = initialViewport({ x: 0, y: 10, w: 800, h: 400 }, size);
    expect(start.zoom).toBe(0.7);
    const top = toScreen(start, { x: 400, y: 10 });
    expect(top.x).toBeCloseTo(INSETS.left + (1000 - 48) / 2);
    expect(top.y).toBeCloseTo(FIT_TOP.board);
  });

  it("initialViewport: a large board at 70%, top left at (24, 24)", () => {
    const start = initialViewport({ x: -100, y: 40, w: 3000, h: 400 }, size);
    expect(start.zoom).toBe(0.7);
    expect(toScreen(start, { x: -100, y: 40 })).toEqual({ x: 24, y: 24 });
  });

  it("initialViewport: an empty board at 70%, origin centered", () => {
    const start = initialViewport(null, size);
    expect(start.zoom).toBe(0.7);
    expect(toScreen(start, { x: 0, y: 0 })).toEqual({ x: 24 + (1000 - 48) / 2, y: 24 + 358 });
  });
});

describe("reveal pan and focus camera (#221 D11·D12·D20, T19)", () => {
  it("revealPan: unchanged if inside", () => {
    const now = vp(0, 0, 1);
    expect(revealPan(now, { x: 100, y: 100, w: 100, h: 100 }, size)).toBe(now);
  });

  it("revealPan: minimal pan if outside, zoom unchanged", () => {
    expect(revealPan(vp(0, 0, 1), { x: 1000, y: 100, w: 100, h: 100 }, size)).toEqual(
      vp(-(1100 - (1000 - 24)), 0, 1),
    );
    expect(revealPan(vp(0, 0, 0.5), { x: -100, y: 0, w: 100, h: 100 }, size)).toEqual(
      vp(24 + 50, 24, 0.5),
    );
  });

  it("revealPan: top-left aligned if larger than the area", () => {
    expect(revealPan(vp(0, 0, 1), { x: 0, y: 0, w: 2000, h: 2000 }, size)).toEqual(vp(24, 24, 1));
  });

  it("focusViewport: unchanged if visible up to 48 on all sides with zoom at least the minimum, otherwise fit", () => {
    const now = vp(0, 0, 1);
    expect(focusViewport(now, { x: 200, y: 200, w: 300, h: 200 }, size, { min: 0.5, max: 1 })).toBe(
      now,
    );
    // 48 around it would reach above the top inset (y 12 < 24)
    expect(
      focusViewport(now, { x: 100, y: 60, w: 300, h: 200 }, size, { min: 0.5, max: 1 }),
    ).not.toBe(now);
    const far = focusViewport(now, { x: 2000, y: 0, w: 300, h: 200 }, size, { min: 0.5, max: 1 });
    expect(far).toEqual(
      fitRect({ x: 2000, y: 0, w: 300, h: 200 }, size, {
        min: 0.5,
        max: 1,
        pad: FOCUS_PAD,
        top: FIT_TOP.focus,
      }),
    );
    // fitted with 48 around it as before, its top 48 below the board's top (Hybrid-Folder-Canvas)
    expect(far.zoom).toBe(1);
    expect(toScreen(far, { x: 2000, y: 0 }).y).toBe(48);
    const small = vp(0, 0, 0.3);
    expect(
      focusViewport(small, { x: 100, y: 100, w: 300, h: 200 }, size, { min: 0.5, max: 1 }).zoom,
    ).toBeGreaterThanOrEqual(0.5);
  });

  it("focusViewport: an open folder puts the top of its project frame (hang) at 48 — the frame's top border never goes under the header row (#231 D14, Hybrid-Folder-Canvas)", () => {
    const sub = { x: 2020, y: 110, w: 300, h: 200 };
    const project = { x: 2000, y: 0, w: 400, h: 400 };
    const hung = focusViewport(vp(0, 0, 1), sub, size, { min: 0.5, max: 1 }, project);
    // the same zoom as fitting the sub-frame alone
    expect(hung.zoom).toBe(focusViewport(vp(0, 0, 1), sub, size, { min: 0.5, max: 1 }).zoom);
    expect(toScreen(hung, { x: 2000, y: 0 }).y).toBe(48);
    // a sub-frame far down its project: lifted only as far as it must to end in the area
    const deep = { x: 2020, y: 900, w: 300, h: 200 };
    const lifted = focusViewport(
      vp(0, 0, 1),
      deep,
      size,
      { min: 0.5, max: 1 },
      {
        ...project,
        h: 1200,
      },
    );
    const end = toScreen(lifted, { x: 2020, y: 1100 }).y;
    expect(end).toBeLessThanOrEqual(size.height - 60);
    expect(toScreen(lifted, { x: 2020, y: 900 }).y).toBeGreaterThanOrEqual(24);
  });
});
