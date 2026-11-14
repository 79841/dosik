import { Position } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";

import { buildEdgePath, slideSegment, type Point } from "../edgeGeometry";
import { handlePointOnNode, routingObstacles } from "../edgeUtils";
import { useDiagramStore } from "../store";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

const right = (x: number, y: number) => ({ x, y, position: Position.Right });
const left = (x: number, y: number) => ({ x, y, position: Position.Left });

const base = {
  waypoints: [],
  parallelOffset: 0,
  obstacles: [],
};

/** number of interior vertices where the direction changes — the visual bend count (a checker independent of the implementation) */
const bendCount = (points: Point[]): number => {
  let bends = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const d1 = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
    const d2 = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) };
    if (d1.x !== d2.x || d1.y !== d2.y) bends++;
  }
  return bends;
};

/** the polyline the edge actually draws in the current store state — the same call as LabeledEdge */
const renderedPoints = (edgeId: string): Point[] => {
  const { nodes, edges } = useDiagramStore.getState();
  const edge = edges.find((e) => e.id === edgeId)!;
  const source = nodes.find((n) => n.id === edge.source)!;
  const target = nodes.find((n) => n.id === edge.target)!;
  const sp = handlePointOnNode(source, edge.sourceHandle);
  const tp = handlePointOnNode(target, edge.targetHandle);
  return buildEdgePath(sp, tp, {
    pathStyle: edge.data?.pathStyle ?? "orthogonal",
    waypoints: edge.data?.waypoints ?? [],
    parallelOffset: 0,
    obstacles: [],
  }).points;
};

/** base layout: a(0,0) → b(400,120) joined by a right→left orthogonal edge "e" (H-V-H, 2 bends) */
const loadPair = () => {
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 400, y: 120 })],
      [
        makeEdge({
          id: "e",
          source: "a",
          target: "b",
          sourceHandle: "right",
          targetHandle: "left",
        }),
      ],
    ),
    null,
  );
};

/** body drag slides the middle vertical segment to x=320 — as in LabeledEdge,
 *  all interior points are stored as waypoints (slice(1, -1)) */
const slideMiddleSegment = (): Point[] => {
  const waypoints = slideSegment(renderedPoints("e"), 1, { x: 320, y: 100 }).slice(1, -1);
  expect(waypoints.length).toBeGreaterThan(0);
  useDiagramStore.getState().updateEdgeDataLive("e", { waypoints });
  return waypoints;
};

const edgeWaypoints = () =>
  useDiagramStore.getState().edges.find((e) => e.id === "e")?.data?.waypoints;

// #69 — an orthogonal edge between two nodes with no obstacles zigzags
describe("Orthogonal edge zigzag (#69)", () => {
  it("no waypoints: two side-by-side nodes get at most 2 bends at any vertical offset", () => {
    // branch A regression assertion — left/right layout with a normal gap (at least two stub lengths)
    for (const dy of [-300, -120, -40, 0, 40, 120, 300]) {
      const src = { x: 0, y: 0, width: 160, height: 80 };
      const tgt = { x: 400, y: dy, width: 160, height: 80 };
      const inflate = (r: typeof src) => ({
        x: r.x - 4,
        y: r.y - 4,
        width: r.width + 8,
        height: r.height + 8,
      });
      const built = buildEdgePath(right(160, 40), left(400, dy + 40), {
        ...base,
        pathStyle: "orthogonal",
        // as in LabeledEdge, the source and target nodes count as obstacles too
        obstacles: [inflate(src), inflate(tgt)],
      });
      expect(bendCount(built.points), `dy=${dy}`).toBeLessThanOrEqual(2);
    }
  });

  it("tight layout: at most 2 bends even when the gap is narrower than two stub lengths", () => {
    // when the facing stubs (fixed 16px) passed each other, the router drew a hook
    // detouring over the box (4 bends) — the scene the user reported
    for (const g of [4, 12, 20, 28]) {
      for (const dy of [0, 8, 40]) {
        const src = { x: 0, y: 0, width: 160, height: 56 };
        const tgt = { x: 160 + g, y: dy, width: 160, height: 56 };
        const inflate = (r: typeof src) => ({
          x: r.x - 4,
          y: r.y - 4,
          width: r.width + 8,
          height: r.height + 8,
        });
        const built = buildEdgePath(right(160, 28), left(160 + g, dy + 28), {
          ...base,
          pathStyle: "orthogonal",
          obstacles: [inflate(src), inflate(tgt)],
        });
        expect(bendCount(built.points), `g=${g} dy=${dy}`).toBeLessThanOrEqual(2);
      }
    }
  });

  describe("Node move after a segment slide", () => {
    beforeEach(() => {
      loadPair();
      expect(bendCount(renderedPoints("e"))).toBe(2);
      slideMiddleSegment();
      // move the target node up by canvas drag — waypoints stay in absolute coordinates
      useDiagramStore
        .getState()
        .onNodesChange([{ id: "b", type: "position", position: { x: 400, y: -120 } }]);
    });

    it("stale waypoints do not cause a zigzag", () => {
      // with no obstacles, the minimal-bend path (H-V-H, 2) is enough.
      expect(bendCount(renderedPoints("e"))).toBeLessThanOrEqual(2);
    });

    it("the path has no vertical segment moving away from the target", () => {
      // the source is below the target: all vertical movement of a correct path goes up.
      const points = renderedPoints("e");
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        expect(b.y, `segment ${i} moves away from target`).toBeLessThanOrEqual(a.y + 0.5);
      }
    });
  });

  it("update_node op moving a node also clears stale waypoints", () => {
    // the same cause surfacing through the bridge — /analyze blast radius
    loadPair();
    slideMiddleSegment();

    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "b", set: { y: -120 } }]);
    expect(result.errors).toEqual([]);

    expect(bendCount(renderedPoints("e"))).toBeLessThanOrEqual(2);
  });

  it("keeps slide waypoints when the node stays put", () => {
    // if the cleanup rule erased valid slides too, #43's manipulation would be pointless
    loadPair();
    slideMiddleSegment();

    // a small move where the slide is still valid — the bend count does not grow
    useDiagramStore
      .getState()
      .onNodesChange([{ id: "b", type: "position", position: { x: 400, y: 140 } }]);

    expect(edgeWaypoints()).toBeDefined();
    // the slid vertical segment keeps its x position
    expect(edgeWaypoints()?.[0]?.x).toBe(320);
  });

  describe("Boundaries of the waypoint cleanup rule", () => {
    it("straight-style waypoints survive node moves", () => {
      // straight/curved waypoints are not routing output but the drawn detour points themselves
      loadPair();
      useDiagramStore
        .getState()
        .updateEdgeDataLive("e", { pathStyle: "straight", waypoints: [{ x: 200, y: 300 }] });
      useDiagramStore
        .getState()
        .onNodesChange([{ id: "b", type: "position", position: { x: 400, y: -120 } }]);
      expect(edgeWaypoints()).toEqual([{ x: 200, y: 300 }]);
    });

    it("moving an unrelated node leaves the edge's waypoints alone", () => {
      loadPair();
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "C", x: 0, y: 400 } }]);
      const waypoints = slideMiddleSegment();
      useDiagramStore
        .getState()
        .onNodesChange([{ id: "c", type: "position", position: { x: 0, y: 900 } }]);
      expect(edgeWaypoints()).toEqual(waypoints);
    });

    it("free arrow waypoints are not cleaned up when an anchor moves", () => {
      // dragging a free arrow moves its waypoints itself — if the cleanup rule stepped in, the bends would vanish
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore.getState().addFreeArrowBetween({ x: 0, y: 0 }, { x: 200, y: 0 });
      const { nodes, edges } = useDiagramStore.getState();
      const edge = edges[0]!;
      const anchor = nodes.find((n) => n.id === edge.source)!;
      useDiagramStore.getState().updateEdgeDataLive(edge.id, { waypoints: [{ x: 100, y: 80 }] });
      useDiagramStore
        .getState()
        .onNodesChange([{ id: anchor.id, type: "position", position: { x: -300, y: -300 } }]);
      const after = useDiagramStore.getState().edges.find((e) => e.id === edge.id);
      expect(after?.data?.waypoints).toEqual([{ x: 100, y: 80 }]);
    });

    it("waypoints are cleared when a resize pushes the handle and worsens the path", () => {
      loadPair();
      slideMiddleSegment();
      // enlarge the target node to push its left handle behind (left of) the waypoints → the chain doubles back
      const result = useDiagramStore
        .getState()
        .applyOps([{ op: "update_node", id: "b", set: { x: 200, width: 600 } }]);
      expect(result.errors).toEqual([]);
      expect(bendCount(renderedPoints("e"))).toBeLessThanOrEqual(2);
      expect(edgeWaypoints()).toBeUndefined();
    });

    it("lifeline alignment (alignLifelines) also clears stale waypoints", () => {
      // a third node-move path — a slide on an orthogonal box↔lifeline edge goes stale after alignment
      useDiagramStore.getState().loadDoc(
        makeDoc(
          [
            makeNode({ id: "a", x: 0, y: 0 }),
            makeNode({ id: "l1", shape: "lifeline", x: 400, y: 300, width: 120, height: 360 }),
            makeNode({ id: "l2", shape: "lifeline", x: 700, y: 0, width: 120, height: 360 }),
          ],
          [
            makeEdge({
              id: "e",
              source: "a",
              target: "l1",
              sourceHandle: "right",
              targetHandle: "left-50",
            }),
          ],
        ),
        null,
      );
      slideMiddleSegment();

      // "tops" alignment pulls l1 up to y=0 — the handle moves 300px up
      useDiagramStore.getState().alignLifelines(["l1", "l2"], "tops");

      expect(edgeWaypoints()).toBeUndefined();
      expect(bendCount(renderedPoints("e"))).toBeLessThanOrEqual(2);
    });

    it("update_node that changes neither position nor size keeps the waypoints", () => {
      loadPair();
      const waypoints = slideMiddleSegment();
      useDiagramStore.getState().applyOps([{ op: "update_node", id: "b", set: { label: "B2" } }]);
      expect(edgeWaypoints()).toEqual(waypoints);
    });

    it("an obstacle-avoiding slide survives a small node move", () => {
      // if the judgment used the obstacle-free path, detour waypoints (4 bends) would be compared against the minimum of 2
      // and wrongly discarded — the baseline must use the same obstacle set as the render
      useDiagramStore.getState().loadDoc(
        makeDoc(
          [
            makeNode({ id: "a", x: 0, y: 0 }),
            makeNode({ id: "b", x: 400, y: 0 }),
            // an obstacle blocking the straight a→b path
            makeNode({ id: "wall", x: 220, y: -80, width: 120, height: 220 }),
          ],
          [
            makeEdge({
              id: "e",
              source: "a",
              target: "b",
              sourceHandle: "right",
              targetHandle: "left",
            }),
          ],
        ),
        null,
      );
      // slide the detour path drawn under the same conditions as the render (obstacles included)
      const { nodes } = useDiagramStore.getState();
      const routed = buildEdgePath(
        handlePointOnNode(nodes[0]!, "right"),
        handlePointOnNode(nodes[1]!, "left"),
        { ...base, pathStyle: "orthogonal", obstacles: routingObstacles(nodes) },
      ).points;
      expect(bendCount(routed)).toBeGreaterThan(2); // a detour has more bends
      const slid = slideSegment(routed, 1, { x: 190, y: -40 }).slice(1, -1);
      useDiagramStore.getState().updateEdgeDataLive("e", { waypoints: slid });

      // nudge an end node — the detour is still needed
      useDiagramStore
        .getState()
        .onNodesChange([{ id: "b", type: "position", position: { x: 400, y: 10 } }]);

      expect(edgeWaypoints()).toBeDefined();
    });

    it("waypoints pruned after the drag-start commit are restored by undo", () => {
      // pins the safety net that relies on the canvas layer's onNodeDragStart → commit order
      loadPair();
      const waypoints = slideMiddleSegment();

      useDiagramStore.getState().commit(); // DiagramCanvas.onNodeDragStart does the same
      useDiagramStore
        .getState()
        .onNodesChange([{ id: "b", type: "position", position: { x: 400, y: -120 } }]);
      expect(edgeWaypoints()).toBeUndefined(); // pruned

      useDiagramStore.getState().undo();
      expect(edgeWaypoints()).toEqual(waypoints);
    });
  });
});
