import { describe, expect, it } from "vitest";

import { fitView, keepInSight, MAX_SCALE, MIN_SCALE, panBy, scaleOf, zoomAt } from "../viewport";

const frame = { width: 400, height: 200 };

describe("Zoom and pan in the in-chat app (#202)", () => {
  it("Fit centers the whole drawing and follows the screen's aspect ratio — no stretching", () => {
    // The drawing is taller than the screen: fit the height and widen the width
    const view = fitView({ x: 0, y: 0, width: 800, height: 800 }, frame);
    expect(view.height).toBe(800);
    expect(view.width).toBe(1600);
    expect(view.x).toBe(-400);
    expect(view.y).toBe(0);
    expect(view.width / view.height).toBe(frame.width / frame.height);
  });

  it("Does not blow a small drawing up to fill the screen — Fit goes only up to actual size", () => {
    const view = fitView({ x: 10, y: 10, width: 40, height: 20 }, frame);
    expect(scaleOf(view, frame)).toBe(1);
    // centered
    expect(view.x + view.width / 2).toBe(30);
    expect(view.y + view.height / 2).toBe(20);
  });

  it("Wheel zoom keeps the point under the pointer fixed", () => {
    const view = { x: 0, y: 0, width: 400, height: 200 };
    const point = { x: 100, y: 50 };
    const zoomed = zoomAt(view, frame, point, 2);
    expect(scaleOf(zoomed, frame)).toBe(2);
    // The drawing coordinate the pointer was on (100, 50) is still under the pointer
    expect(zoomed.x + point.x / 2).toBe(100);
    expect(zoomed.y + point.y / 2).toBe(50);
  });

  it("The scale stops at the upper and lower limits", () => {
    const view = { x: 0, y: 0, width: 400, height: 200 };
    expect(scaleOf(zoomAt(view, frame, { x: 0, y: 0 }, 1000), frame)).toBe(MAX_SCALE);
    expect(scaleOf(zoomAt(view, frame, { x: 0, y: 0 }, 0.0001), frame)).toBe(MIN_SCALE);
  });

  it("Dragging moves the drawing as far as the pointer moved on screen — less when zoomed in", () => {
    const view = { x: 0, y: 0, width: 200, height: 100 }; // 2x
    expect(panBy(view, frame, 40, -20)).toEqual({ x: -20, y: 10, width: 200, height: 100 });
  });

  it("Fit holds the whole drawing even when it needs a scale below the lower limit", () => {
    const view = fitView({ x: 0, y: 0, width: 20000, height: 2000 }, { width: 640, height: 200 });
    expect(view.width).toBeGreaterThanOrEqual(20000);
    expect(view.height).toBeGreaterThanOrEqual(2000);
  });

  it("The zoom-out limit opens up to that drawing's fit scale", () => {
    const small = { width: 640, height: 200 };
    const fit = fitView({ x: 0, y: 0, width: 20000, height: 2000 }, small);
    const fitScale = scaleOf(fit, small);
    const zoomedOut = zoomAt(fit, small, { x: 0, y: 0 }, 0.0001, fitScale);
    expect(scaleOf(zoomedOut, small)).toBeCloseTo(fitScale);
  });

  it("Panning stops while part of the drawing is still in the frame — it can't be pushed off into an empty view", () => {
    const content = { x: 0, y: 0, width: 400, height: 200 };
    const view = { x: 0, y: 0, width: 400, height: 200 };
    const far = keepInSight(panBy(view, frame, -100000, -100000), content);
    // Going past the drawing's right and bottom edges still leaves part of it visible
    expect(far.x).toBeLessThan(content.x + content.width);
    expect(far.y).toBeLessThan(content.y + content.height);
    const near = keepInSight(panBy(view, frame, 100000, 100000), content);
    expect(near.x + near.width).toBeGreaterThan(content.x);
    expect(near.y + near.height).toBeGreaterThan(content.y);
    // Panning inward is unchanged
    expect(keepInSight(panBy(view, frame, 10, 10), content)).toEqual(panBy(view, frame, 10, 10));
  });
});
