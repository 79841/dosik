import { describe, expect, it } from "vitest";

import { edgeSiblings, layoutEdge } from "../../../features/canvas/edgeLayout";
import { renderVectorSvg } from "../../../features/export/vectorSvg";
import type { Point } from "../edgeGeometry";
import { handlePointOnNode } from "../edgeUtils";
import { bothEnds, placeEnds } from "../placeEnds";
import { useDiagramStore } from "../store";
import type { DiagramEdge, DiagramNode, EdgeWaypoint } from "../types";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

/**
 * The line as both renderers draw it: the SVG export hands `layoutEdge` the
 * whole edge list, the canvas hands it the sibling numbers it worked out
 * itself. The two must agree, so every case is checked both ways.
 */
const drawn = (edge: DiagramEdge, nodes: DiagramNode[], edges: DiagramEdge[]): Point[] => {
  const svg = layoutEdge(edge, nodes, { edges });
  const canvas = layoutEdge(edge, nodes, { siblings: edgeSiblings(edge, nodes, edges) });
  expect(canvas?.points).toEqual(svg?.points);
  return svg!.points;
};

const box = (id: string, x: number, y: number, width: number, height: number) =>
  makeNode({ id, shape: "rect", x, y, width, height });

const line = (
  id: string,
  source: string,
  target: string,
  sourceHandle = "right",
  targetHandle = "left",
): DiagramEdge => makeEdge({ id, source, target, sourceHandle, targetHandle });

const ends = (points: Point[]) => ({ first: points[0]!, last: points[points.length - 1]! });

/** a free end (anchor) centred on `at` */
const freeEnd = (id: string, at: Point) =>
  makeNode({ id, shape: "anchor", x: at.x - 6, y: at.y - 6, width: 12, height: 12 });

// the reported case: tops level, 144px against 164px, 10px apart in the middle
const small = box("a", 0, 0, 160, 144);
const large = box("b", 400, 0, 160, 164);

describe("straight line between facing sides that overlap", () => {
  it("joins a 144px and a 164px box with tops level by one straight horizontal line", () => {
    const edge = line("e", "a", "b");
    const points = drawn(edge, [small, large], [edge]);
    // the smaller box's middle (72) is inside the larger one's side, so the
    // larger box's end slides up to meet it — no 10px step in the middle
    expect(points).toEqual([
      { x: 160, y: 72 },
      { x: 400, y: 72 },
    ]);
  });

  it("joins a 144px and a 164px wide box with left edges level by one straight vertical line", () => {
    const nodes = [box("a", 0, 0, 144, 56), box("b", 0, 200, 164, 56)];
    const edge = line("e", "a", "b", "bottom", "top");
    const points = drawn(edge, nodes, [edge]);
    expect(points).toEqual([
      { x: 72, y: 56 },
      { x: 72, y: 200 },
    ]);
  });

  it("keeps the smaller box's middle when the line runs the other way", () => {
    const edge = line("e", "b", "a", "left", "right");
    expect(drawn(edge, [small, large], [edge])).toEqual([
      { x: 400, y: 72 },
      { x: 160, y: 72 },
    ]);
  });

  it("meets the smaller box's middle when only that one lies inside the other side", () => {
    // tall box 0..200 (middle 100); short box 150..210 (middle 180) — 100 is
    // off the short side, 180 is on the tall one: the tall box's end slides
    const nodes = [box("a", 0, 0, 160, 200), box("b", 400, 150, 160, 60)];
    const edge = line("e", "a", "b");
    expect(drawn(edge, nodes, [edge])).toEqual([
      { x: 160, y: 180 },
      { x: 400, y: 180 },
    ]);
  });

  it("takes the spot of the overlap nearest the shorter side's middle when that middle is out of reach", () => {
    // usable stretches 8..92 and 68..252 overlap on 68..92; the shorter
    // side's middle (50) is above it, so the line runs along its top, 68
    const nodes = [box("a", 0, 0, 160, 100), box("b", 400, 60, 160, 200)];
    const edge = line("e", "a", "b");
    expect(drawn(edge, nodes, [edge])).toEqual([
      { x: 160, y: 68 },
      { x: 400, y: 68 },
    ]);
  });

  it("does the same for top and bottom sides", () => {
    const nodes = [box("a", 0, 0, 100, 56), box("b", 60, 200, 200, 56)];
    const edge = line("e", "a", "b", "bottom", "top");
    expect(drawn(edge, nodes, [edge])).toEqual([
      { x: 68, y: 56 },
      { x: 68, y: 200 },
    ]);
  });

  it("moves the line smoothly while a box is dragged across the overlap — never a jump", () => {
    // the 164px box slides down 1px at a time while the sides overlap
    // (its top from -148 to 128): the level line may move 1px per step, no more
    const edge = line("e", "a", "b");
    let previous: number | null = null;
    for (let y = -148; y <= 128; y += 1) {
      const points = drawn(edge, [small, box("b", 400, y, 160, 164)], [edge]);
      expect(points, `b at ${y}`).toHaveLength(2);
      const at = points[0]!.y;
      expect(points[1]!.y, `b at ${y}`).toBe(at);
      if (previous !== null) expect(Math.abs(at - previous), `b at ${y}`).toBeLessThanOrEqual(1);
      previous = at;
    }
  });

  it("keeps an ellipse's middle over a box's — the end with the shorter usable stretch stays", () => {
    // an ellipse's ends keep to the middle half of its side (41..123 here)
    const ellipse = makeNode({ id: "b", shape: "ellipse", x: 400, y: 0, width: 160, height: 164 });
    const edge = line("e", "a", "b");
    expect(drawn(edge, [small, ellipse], [edge])).toEqual([
      { x: 160, y: 82 },
      { x: 400, y: 82 },
    ]);
  });

  it("reaches in to a curved outline from the spot the end slid to, still level", () => {
    const ellipse = makeNode({ id: "b", shape: "ellipse", x: 400, y: 0, width: 160, height: 164 });
    // the box's end is placed at y 45; the ellipse's slides up to meet it
    const edge = line("e", "a", "b", "right-31.25", "left");
    const { first, last } = ends(drawn(edge, [small, ellipse], [edge]));
    expect(first).toEqual({ x: 160, y: 45 });
    // 37px off the ellipse's middle its outline is some 8.6px inside the box
    expect(last.y).toBe(45);
    expect(last.x).toBeGreaterThan(408);
    expect(last.x).toBeLessThan(409);
  });

  it("draws the same straight line in the vector SVG", () => {
    const edge = line("e", "a", "b");
    const svg = renderVectorSvg(makeDoc([small, large], [edge]));
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const d = dom.querySelector("[data-edge='e'] path.edge")?.getAttribute("d");
    expect(d).toBe(layoutEdge(edge, [small, large], { edges: [edge] })?.d);
    expect(d).toBe("M 160 72 L 400 72");
  });
});

describe("straight line between facing sides — what stays as it was", () => {
  it("bends as before when the sides do not overlap", () => {
    const nodes = [box("a", 0, 0, 160, 56), box("b", 400, 120, 160, 56)];
    const edge = line("e", "a", "b");
    const points = drawn(edge, nodes, [edge]);
    expect(ends(points)).toEqual({ first: { x: 160, y: 28 }, last: { x: 400, y: 148 } });
    expect(points.length).toBeGreaterThan(2);
  });

  it("bends as before when the overlap is narrower than the corner margins", () => {
    // sides overlap on 130..144 (14px), less than the 16px the two shapes'
    // corner margins (8px each) take — no spot both ends may use
    const nodes = [small, box("b", 400, 130, 160, 164)];
    const edge = line("e", "a", "b");
    const points = drawn(edge, nodes, [edge]);
    expect(ends(points)).toEqual({ first: { x: 160, y: 72 }, last: { x: 400, y: 212 } });
    expect(points.length).toBeGreaterThan(2);
  });

  it("never moves an end the user put on its side — the auto end meets it", () => {
    // left-25 on the 164px side is y 41, inside the small box's side
    const edge = line("e", "a", "b", "right", "left-25");
    const { first, last } = ends(drawn(edge, [small, large], [edge]));
    expect(last).toEqual({ x: 400, y: 41 });
    expect(first).toEqual({ x: 160, y: 41 });
  });

  it("bends as before when the user's end is out of the other end's reach", () => {
    // left-87.5 is y 143.5, below the small box's usable stretch (8..136)
    const edge = line("e", "a", "b", "right", "left-87.5");
    const points = drawn(edge, [small, large], [edge]);
    expect(ends(points)).toEqual({ first: { x: 160, y: 72 }, last: { x: 400, y: 143.5 } });
  });

  it("bends as before when both ends were put by the user", () => {
    const edge = line("e", "a", "b", "right-25", "left-37.5");
    const points = drawn(edge, [small, large], [edge]);
    expect(ends(points)).toEqual({ first: { x: 160, y: 36 }, last: { x: 400, y: 61.5 } });
    expect(points.length).toBeGreaterThan(2);
  });

  it("leaves a line with stored bends alone", () => {
    const waypoints: EdgeWaypoint[] = [
      { x: 320, y: 72 },
      { x: 320, y: 82 },
    ];
    const base = line("e", "a", "b");
    const edge: DiagramEdge = { ...base, data: { ...base.data!, waypoints } };
    const points = drawn(edge, [small, large], [edge]);
    expect(ends(points)).toEqual({ first: { x: 160, y: 72 }, last: { x: 400, y: 82 } });
    expect(points).toContainEqual({ x: 320, y: 82 });
  });

  it("leaves a straight or curved line alone — only the orthogonal router steps", () => {
    for (const pathStyle of ["straight", "curved"] as const) {
      const base = line("e", "a", "b");
      const edge: DiagramEdge = { ...base, data: { ...base.data!, pathStyle } };
      const { first, last } = ends(drawn(edge, [small, large], [edge]));
      expect(first, pathStyle).toEqual({ x: 160, y: 72 });
      expect(last, pathStyle).toEqual({ x: 400, y: 82 });
    }
  });

  it("keeps the ends spreading put on a shared side, and slides only an end alone on its side", () => {
    // two lines leave the small box's right side: placing them spreads that
    // side, while each far side keeps a lone end in its middle
    const below = box("c", 400, 300, 160, 56);
    const nodes = [small, large, below];
    const placed = placeEnds(
      nodes,
      [line("e1", "a", "b"), line("e2", "a", "c")],
      bothEnds(["e1", "e2"]),
    );
    const [e1, e2] = placed;
    expect(e1!.sourceHandle).not.toBe("right");
    const spot1 = handlePointOnNode(small, e1!.sourceHandle);
    const spot2 = handlePointOnNode(small, e2!.sourceHandle);
    const p1 = ends(drawn(e1!, nodes, placed));
    const p2 = ends(drawn(e2!, nodes, placed));
    // the spread ends stay where spreading put them
    expect(p1.first).toEqual({ x: spot1.x, y: spot1.y });
    expect(p2.first).toEqual({ x: spot2.x, y: spot2.y });
    // the large box's lone end meets the spread one straight across
    expect(p1.last).toEqual({ x: 400, y: spot1.y });
    // the box below is out of reach, so its end stays in the middle
    expect(p2.last).toEqual({ x: 400, y: 328 });
  });

  it("does not slide a bare end that shares its side with another line", () => {
    // parallel lines share both sides: each end stays in the middle and the
    // pair keeps its parallel offset
    const edges = [line("e1", "a", "b"), line("e2", "a", "b")];
    for (const edge of edges) {
      const { first, last } = ends(drawn(edge, [small, large], edges));
      expect(first, edge.id).toEqual({ x: 160, y: 72 });
      expect(last, edge.id).toEqual({ x: 400, y: 82 });
    }
  });

  it("bends as before when another shape stands in the straight line's way", () => {
    const between = box("c", 240, 40, 80, 60);
    const nodes = [small, large, between];
    const edge = line("e", "a", "b");
    const { first, last } = ends(drawn(edge, nodes, [edge]));
    expect(first).toEqual({ x: 160, y: 72 });
    expect(last).toEqual({ x: 400, y: 82 });
  });

  it("leaves touching boxes to the stub rules", () => {
    const edge = line("e", "a", "b");
    const { first, last } = ends(drawn(edge, [small, box("b", 160, 0, 160, 164)], [edge]));
    expect(first).toEqual({ x: 160, y: 72 });
    expect(last).toEqual({ x: 160, y: 82 });
  });

  it("leaves the end in the middle when a free end is out of its reach or behind its side", () => {
    const tall = box("a", 0, 0, 160, 164);
    for (const at of [
      { x: 400, y: 200 },
      { x: 100, y: 76 },
    ]) {
      const anchor = freeEnd("p", at);
      const edge = line("e", "a", "p", "right", "center");
      expect(ends(drawn(edge, [tall, anchor], [edge])).first, JSON.stringify(at)).toEqual({
        x: 160,
        y: 82,
      });
    }
  });
});

describe("straight line to a free end", () => {
  it("slides an auto end level with a free end in front of its side", () => {
    const anchor = freeEnd("p", { x: 400, y: 76 });
    const edge = line("e", "a", "p", "right", "center");
    expect(drawn(edge, [box("a", 0, 0, 160, 164), anchor], [edge])).toEqual([
      { x: 160, y: 76 },
      { x: 400, y: 76 },
    ]);
  });

  it("leaves an end the user put on its side where it is", () => {
    const anchor = freeEnd("p", { x: 400, y: 76 });
    const edge = line("e", "a", "p", "right-25", "center");
    expect(ends(drawn(edge, [box("a", 0, 0, 160, 164), anchor], [edge])).first).toEqual({
      x: 160,
      y: 41,
    });
  });
});

describe("grabbing an end of a straightened line", () => {
  const layoutNow = () => {
    const { nodes, edges } = useDiagramStore.getState();
    return layoutEdge(edges[0]!, nodes, { edges })!.points;
  };

  for (const end of ["source", "target"] as const) {
    it(`leaves the line where it was the moment the ${end} end comes loose`, () => {
      useDiagramStore.getState().loadDoc(makeDoc([small, large], [line("e", "a", "b")]), null);
      const before = layoutNow();
      expect(before).toEqual([
        { x: 160, y: 72 },
        { x: 400, y: 72 },
      ]);
      // the end comes loose where it is drawn — the larger box's end has
      // slid off its handle (82) to 72
      const tip = end === "source" ? before[0]! : before[before.length - 1]!;
      useDiagramStore.getState().detachEndpointToAnchor("e", end, tip);
      expect(layoutNow()).toEqual(before);
    });
  }

  it("keeps the far end level with the dragged end while it is within that side's reach", () => {
    useDiagramStore.getState().loadDoc(makeDoc([small, large], [line("e", "a", "b")]), null);
    const anchorId = useDiagramStore.getState().detachEndpointToAnchor("e", "source", {
      x: 160,
      y: 72,
    })!;
    // dragged into the open between the boxes, a little lower
    useDiagramStore.getState().setNodePositionLive(anchorId, 220 - 6, 90 - 6);
    expect(layoutNow()).toEqual([
      { x: 220, y: 90 },
      { x: 400, y: 90 },
    ]);
  });
});

describe("bends left on a straightened line", () => {
  it("are dropped when a moved box leaves them worse than the straight line", () => {
    // the step a segment slide left at x 300, before lines straightened
    const base = line("e", "a", "b");
    const edge: DiagramEdge = {
      ...base,
      data: {
        ...base.data!,
        waypoints: [
          { x: 300, y: 72 },
          { x: 300, y: 82 },
        ],
      },
    };
    const store = useDiagramStore.getState();
    store.loadDoc(makeDoc([small, large], [edge]), null);
    store.onNodesChange([{ id: "b", type: "position", position: { x: 420, y: 0 } }]);
    const { nodes, edges } = useDiagramStore.getState();
    expect(edges[0]!.data?.waypoints).toBeUndefined();
    expect(layoutEdge(edges[0]!, nodes, { edges })!.points).toEqual([
      { x: 160, y: 72 },
      { x: 420, y: 72 },
    ]);
  });
});

describe("moving a straightened line by its body", () => {
  it("starts from where the line is drawn, so it stays one straight line", () => {
    const store = useDiagramStore.getState();
    store.loadDoc(makeDoc([small, large], [line("e", "a", "b")]), null);
    // drawn level at y 72; dragging the body down to y 100 moves it whole
    store.slideEdgeLine("e", { x: 280, y: 100 });
    const { nodes, edges } = useDiagramStore.getState();
    const edge = edges.find((e) => e.id === "e")!;
    const s = handlePointOnNode(nodes.find((n) => n.id === "a")!, edge.sourceHandle);
    const t = handlePointOnNode(nodes.find((n) => n.id === "b")!, edge.targetHandle);
    // both handles round to a hundredth of a percent
    expect(s.y).toBeCloseTo(100, 1);
    expect(t.y).toBeCloseTo(100, 1);
    expect(edge.sourceHandle?.startsWith("right")).toBe(true);
    expect(edge.targetHandle?.startsWith("left")).toBe(true);
  });
});
