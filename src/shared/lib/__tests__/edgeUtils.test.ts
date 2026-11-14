import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { DiagramNode } from "../types";

import {
  effectiveMarkerEnd,
  effectiveMarkerStart,
  findSnapTarget,
  handlePointOnNode,
  lifelineHandleAtY,
  isSequenceMessage,
  lifelineAttachRange,
  lifelineLineRange,
  nodeBounds,
  pickEdgeStyle,
  rectsOverlap,
} from "../edgeUtils";
import { makeEdge, makeNode } from "./testFixtures";

describe("handlePointOnNode", () => {
  const node = makeNode({ id: "a", x: 100, y: 200, width: 160, height: 56 });

  it("center/body/null return the node center", () => {
    for (const handle of ["center", "body", null, undefined]) {
      const p = handlePointOnNode(node, handle);
      expect(p.x).toBe(180);
      expect(p.y).toBe(228);
    }
  });

  it("computes the 4 side handles and the -25/-75 ratio handles", () => {
    expect(handlePointOnNode(node, "top")).toEqual({ x: 180, y: 200, position: Position.Top });
    expect(handlePointOnNode(node, "bottom")).toEqual({
      x: 180,
      y: 256,
      position: Position.Bottom,
    });
    expect(handlePointOnNode(node, "left")).toEqual({ x: 100, y: 228, position: Position.Left });
    expect(handlePointOnNode(node, "right")).toEqual({ x: 260, y: 228, position: Position.Right });
    expect(handlePointOnNode(node, "top-25").x).toBe(140);
    expect(handlePointOnNode(node, "top-75").x).toBe(220);
    expect(handlePointOnNode(node, "left-25").y).toBe(214);
  });

  it("treats unknown handle ids as top", () => {
    const p = handlePointOnNode(node, "nonsense");
    expect(p.position).toBe(Position.Top);
  });

  it("parses arbitrary percent suffixes and clamps out-of-range values", () => {
    expect(handlePointOnNode(node, "left-37.5").y).toBe(200 + 56 * 0.375);
    expect(handlePointOnNode(node, "top-0").x).toBe(100);
    expect(handlePointOnNode(node, "top-100").x).toBe(260);
    expect(handlePointOnNode(node, "left-150").y).toBe(256);
    expect(handlePointOnNode(node, "left-abc").y).toBe(228);
  });

  it("lifeline left/right handles sit on the center line", () => {
    const lifeline = makeNode({
      id: "l",
      shape: "lifeline",
      x: 100,
      y: 0,
      width: 120,
      height: 400,
    });
    const left = handlePointOnNode(lifeline, "left-50");
    const right = handlePointOnNode(lifeline, "right-25");
    expect(left).toEqual({ x: 160, y: 200, position: Position.Left });
    expect(right).toEqual({ x: 160, y: 100, position: Position.Right });
    // top/bottom attach to the border like regular shapes
    expect(handlePointOnNode(lifeline, "top").y).toBe(0);
  });
});

describe("lifeline helpers", () => {
  const lifeline = makeNode({ id: "l", shape: "lifeline", x: 100, y: 50, width: 120, height: 400 });

  it("lifelineLineRange: from below the header to the node bottom", () => {
    expect(lifelineLineRange(lifeline)).toEqual({ min: 90, max: 450 });
  });

  it("lifelineHandleAtY: converts an absolute y to a pct handle and clamps it to the line range", () => {
    expect(lifelineHandleAtY(lifeline, 250, "right")).toBe("right-50");
    expect(lifelineHandleAtY(lifeline, 0, "left")).toBe("left-10"); // above the header → line start
    expect(lifelineHandleAtY(lifeline, 9999, "left")).toBe("left-100");
    // round trip: converting back from the handle gives the same y
    const handle = lifelineHandleAtY(lifeline, 313, "right");
    expect(handlePointOnNode(lifeline, handle).y).toBeCloseTo(313, 0);
  });
});

describe("findSnapTarget", () => {
  const box = makeNode({ id: "box", x: 0, y: 0, width: 100, height: 60 });

  it("out of range gives null", () => {
    expect(findSnapTarget([box], { x: 500, y: 500 })).toBeNull();
  });

  it("ignores nodes in the exclude list", () => {
    expect(findSnapTarget([box], { x: 110, y: 30 }, ["box"])).toBeNull();
  });

  it("picks the representative handle of the nearest side", () => {
    const snap = findSnapTarget([box], { x: 108, y: 30 });
    expect(snap?.nodeId).toBe("box");
    expect(snap?.handle).toBe("right");
    expect(snap?.point).toEqual({ x: 100, y: 30 });
  });

  it("attaches at the pointer spot, not the middle of the side (#204 D4)", () => {
    const snap = findSnapTarget([box], { x: 108, y: 15 });
    expect(snap?.handle).toBe("right-25");
    expect(snap?.point).toEqual({ x: 100, y: 15 });
  });

  it("near a corner, clamps to the usable span", () => {
    // just inside the top-right corner: the top side is closer, 8px from the corner
    const snap = findSnapTarget([box], { x: 97, y: 2 });
    expect(snap?.handle).toBe("top-92");
  });

  it("an ellipse returns a point on its outline", () => {
    const ellipse = makeNode({ id: "e", shape: "ellipse", x: 0, y: 0, width: 100, height: 60 });
    const snap = findSnapTarget([ellipse], { x: -5, y: 20 });
    expect(snap?.handle).toBe("left-33.33");
    // inside the bounding box (x=0) — the actual outline
    expect(snap?.point.x).toBeGreaterThan(0);
    const dy = (20 - 30) / 30;
    expect(snap?.point.x).toBeCloseTo(50 * (1 - Math.sqrt(1 - dy * dy)), 2);
  });

  it("a lifeline snaps to the center line point at the pointer y", () => {
    const lifeline = makeNode({ id: "l", shape: "lifeline", x: 0, y: 0, width: 120, height: 400 });
    const snap = findSnapTarget([lifeline], { x: 40, y: 250 });
    expect(snap?.nodeId).toBe("l");
    expect(snap?.handle).toBe("left-62.5");
    expect(snap?.point).toEqual({ x: 60, y: 250 });
    // a y in the header area clamps to the line start
    const headerSnap = findSnapTarget([lifeline], { x: 90, y: 10 });
    expect(headerSnap?.handle).toBe("right-10");
    expect(headerSnap?.point.y).toBe(40);
  });
});

describe("edge style helpers", () => {
  it("pickEdgeStyle keeps only style keys", () => {
    const style = pickEdgeStyle({
      variant: "dashed",
      color: "rose",
      label: "ignored",
      waypoints: [{ x: 1, y: 1 }],
      arrow: true,
    });
    expect(style).toEqual({ variant: "dashed", color: "rose" });
  });

  it("effectiveMarkerEnd: absorbs the legacy arrow boolean", () => {
    expect(effectiveMarkerEnd(undefined)).toBe("arrow");
    expect(effectiveMarkerEnd({ arrow: false })).toBe("none");
    expect(effectiveMarkerEnd({ arrow: false, markerEnd: "diamond" })).toBe("diamond");
    expect(effectiveMarkerStart({})).toBe("none");
    expect(effectiveMarkerStart({ markerStart: "circle" })).toBe("circle");
  });
});

describe("rects", () => {
  it("rectsOverlap: overlapping / separate / touching", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 20, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("nodeBounds: uses the shape's default size when no size is given", () => {
    const sized = makeNode({ id: "a", x: 5, y: 6, width: 120, height: 40 });
    expect(nodeBounds(sized)).toEqual({ x: 5, y: 6, width: 120, height: 40 });
    const unsized = { ...sized, width: undefined, height: undefined };
    const b = nodeBounds(unsized);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });
});

describe("isSequenceMessage", () => {
  const lifeline = (id: string, x: number) =>
    makeNode({ id, shape: "lifeline", x, y: 0, width: 120, height: 360 });
  const anchor = (id: string, x: number, y: number) =>
    makeNode({ id, shape: "anchor", x, y, width: 12, height: 12 });

  it("is a message when both ends are lifelines", () => {
    const nodes = [lifeline("a", 0), lifeline("b", 300)];
    const edge = makeEdge({
      id: "m",
      source: "a",
      target: "b",
      sourceHandle: "right-50",
      targetHandle: "left-50",
    });
    expect(isSequenceMessage(edge, nodes)).toBe(true);
  });

  it("anchor ↔ lifeline pct handle is a message (found/lost)", () => {
    const nodes = [lifeline("a", 300), anchor("p", 40, 174)];
    const found = makeEdge({
      id: "f",
      source: "p",
      target: "a",
      sourceHandle: "center",
      targetHandle: "left-50",
    });
    expect(isSequenceMessage(found, nodes)).toBe(true);
    const lost = makeEdge({
      id: "l",
      source: "a",
      target: "p",
      sourceHandle: "left-50",
      targetHandle: "center",
    });
    expect(isSequenceMessage(lost, nodes)).toBe(true);
  });

  it("a free arrow from an anchor to a lifeline's plain side handle is not a message", () => {
    const nodes = [lifeline("a", 300), anchor("p", 40, 174)];
    const free = makeEdge({
      id: "e",
      source: "p",
      target: "a",
      sourceHandle: "center",
      targetHandle: "left",
    });
    expect(isSequenceMessage(free, nodes)).toBe(false);
  });

  it("is not a message when a regular node is involved", () => {
    const nodes = [lifeline("a", 0), makeNode({ id: "box", x: 300, y: 100 })];
    const edge = makeEdge({
      id: "e",
      source: "a",
      target: "box",
      sourceHandle: "right-50",
      targetHandle: "left",
    });
    expect(isSequenceMessage(edge, nodes)).toBe(false);
  });

  it("is not a message when it points at a missing node", () => {
    const nodes = [lifeline("a", 0)];
    const edge = makeEdge({
      id: "e",
      source: "a",
      target: "ghost",
      sourceHandle: "right-50",
      targetHandle: "left-50",
    });
    expect(isSequenceMessage(edge, nodes)).toBe(false);
  });
});

describe("lifelineAttachRange — destroy limit (new handles only)", () => {
  const lifeline = (destroyY?: number): DiagramNode =>
    ({
      id: "l",
      type: "shape",
      position: { x: 0, y: 100 },
      width: 120,
      height: 360,
      data: { label: "L", shape: "lifeline", color: "violet", ...(destroyY ? { destroyY } : {}) },
    }) as DiagramNode;

  it("without destroy, reaches down to the bottom", () => {
    expect(lifelineAttachRange(lifeline())).toEqual({ min: 140, max: 460 });
  });

  it("with destroy, that point is the limit (converted to absolute coordinates)", () => {
    // node y=100, destroyY=200 (relative) → absolute 300
    expect(lifelineAttachRange(lifeline(200))).toEqual({ min: 140, max: 300 });
  });

  it("an out-of-range destroy is not a limit (it is not rendered)", () => {
    expect(lifelineAttachRange(lifeline(9999))).toEqual({ min: 140, max: 460 });
    expect(lifelineAttachRange(lifeline(10))).toEqual({ min: 140, max: 460 });
  });

  it("the geometric lifelineLineRange is unaffected by destroy", () => {
    // it recomputes handles of existing messages, so it must not shrink —
    // otherwise placing a destroy would make the messages below it jump up
    expect(lifelineLineRange(lifeline(200))).toEqual({ min: 140, max: 460 });
  });
});
