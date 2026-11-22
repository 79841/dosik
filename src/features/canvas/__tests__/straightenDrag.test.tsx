import { act, fireEvent, render } from "@testing-library/react";
import type { Node, NodeChange } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { handlePointOnNode } from "../../../shared/lib/edgeUtils";
import { useDiagramStore } from "../../../shared/lib/store";
import type { DiagramEdge, DiagramNode } from "../../../shared/lib/types";

/**
 * A connector between two boxes of different heights can never be made
 * straight by moving one of them.
 *
 * A dragged box lands with its top-left corner on the 8px grid, and a
 * connector's end sits in the middle of its side. With a 160×144 box `a` and
 * a 160×164 box `b`, the middles of `a`'s right side and `b`'s left side
 * stand level only with `b` 10px above `a` — a spot off the grid, so every
 * place `b` can be put leaves a step in the line (10px, 2px, 6px, ...).
 *
 * jsdom cannot run a drag itself, so this mimics what React Flow does over
 * one (as `dragAutoPanSnap.test.tsx` does): positions already snapped to the
 * grid go through `onNodesChange`, then `onNodeDragStop`.
 */
const captured: Record<string, unknown> = {};

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const { useEffect } = await import("react");
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      Object.assign(captured, props);
      const rfStore = actual.useStoreApi();
      useEffect(() => {
        rfStore.setState({ snapToGrid: props.snapToGrid as boolean });
      }, [rfStore, props.snapToGrid]);
      return <div data-testid="flow" />;
    },
  };
});

const { DiagramCanvas } = await import("../DiagramCanvas");
const { ReactFlowProvider, useStoreApi: useRfStore } = await import("@xyflow/react");

type Handlers = {
  onNodesChange: (changes: NodeChange<DiagramNode>[]) => void;
  onNodeDragStart: (e: MouseEvent, node: Node, nodes: Node[]) => void;
  onNodeDrag: (e: MouseEvent, node: Node, nodes: Node[]) => void;
  onNodeDragStop: (e: MouseEvent, node: Node, nodes: Node[]) => void;
};
const flow = () => captured as unknown as Handlers;

type XY = { x: number; y: number };
const store = () => useDiagramStore.getState();
const node = (id: string) => store().nodes.find((n) => n.id === id)!;
/**
 * A dragged node as React Flow passes it to its drag callbacks: at React
 * Flow's own position — on the grid, or wherever snapping paused — not where
 * the canvas then put it.
 */
const rfNode = (id: string, position: XY, dragging: boolean): Node => ({
  ...node(id),
  position,
  dragging,
});

const CENTRE: [number, number] = [500, 350];
/** 20px in from the left edge: the view slides there, and snapping pauses */
const EDGE: [number, number] = [20, 350];
const pointer = ([clientX, clientY]: [number, number]) =>
  new MouseEvent("mousemove", { clientX, clientY });
const primaryAt = ([clientX, clientY]: [number, number]) => ({
  isPrimary: true,
  clientX,
  clientY,
});

beforeEach(() => {
  let rf: ReturnType<typeof useRfStore> | null = null;
  const GrabRfStore = () => {
    rf = useRfStore();
    return null;
  };
  render(
    <ReactFlowProvider>
      <GrabRfStore />
      <DiagramCanvas />
    </ReactFlowProvider>,
  );
  const paneEl = document.createElement("div");
  paneEl.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
      x: 0,
      y: 0,
      right: 1000,
      bottom: 700,
    }) as DOMRect;
  rf!.setState({ domNode: paneEl });
});

const seed = (nodes: DiagramNode[], edges: DiagramEdge[]) =>
  store().loadDoc(makeDoc(nodes, edges), null);

/** React Flow's drag of `id`, a step at a time; `at` is the pointer */
const startDrag = (id: string, at: [number, number] = CENTRE) =>
  act(() => {
    const n = rfNode(id, node(id).position, true);
    flow().onNodeDragStart(pointer(at), n, [n]);
  });
const stepTo = (id: string, position: XY, at: [number, number] = CENTRE) =>
  act(() => {
    fireEvent.pointerMove(document.body, primaryAt(at));
    flow().onNodesChange([{ type: "position", id, position, dragging: true }]);
    const n = rfNode(id, position, true);
    flow().onNodeDrag(pointer(at), n, [n]);
  });
/** the release, React Flow's last move to where it has the node, then its stop */
const drop = (id: string, position: XY, at: [number, number] = CENTRE) =>
  act(() => {
    fireEvent.pointerUp(document.body, primaryAt(at));
    flow().onNodesChange([{ type: "position", id, position, dragging: false }]);
    const n = rfNode(id, position, false);
    flow().onNodeDragStop(pointer(at), n, [n]);
  });
/**
 * One drag of `id` through the positions React Flow computed — on the grid
 * unless the pointer `at` paused snapping by the view's edge — dropped at the
 * last.
 */
const drag = (id: string, steps: XY[], at: [number, number] = CENTRE) => {
  startDrag(id, at);
  for (const position of steps) stepTo(id, position, at);
  drop(id, steps[steps.length - 1]!, at);
};

/** how far apart the two ends of `edge` stand across the line's run */
const step = (edge: DiagramEdge, axis: "x" | "y") =>
  Math.abs(
    handlePointOnNode(node(edge.source), edge.sourceHandle)[axis] -
      handlePointOnNode(node(edge.target), edge.targetHandle)[axis],
  );

describe("a dragged box can make its connector straight", () => {
  const a = makeNode({ id: "a", x: 0, y: 0, width: 160, height: 144 });
  const b = makeNode({ id: "b", x: 240, y: 40, width: 160, height: 164 });
  const link = makeEdge({
    id: "e",
    source: "a",
    target: "b",
    sourceHandle: "right",
    targetHandle: "left",
  });

  it("lands b where the line runs straight when the grid puts it 2px off", () => {
    seed([a, b], [link]);
    drag("b", [
      { x: 240, y: 16 },
      { x: 240, y: -8 },
    ]);
    expect(node("b").position).toEqual({ x: 240, y: -10 });
    expect(step(link, "y")).toBe(0);
  });

  it("lands b there from 6px off too, and keeps the grid farther away", () => {
    seed([a, b], [link]);
    drag("b", [{ x: 240, y: -16 }]);
    expect(node("b").position).toEqual({ x: 240, y: -10 });
    drag("b", [{ x: 240, y: -24 }]);
    expect(node("b").position).toEqual({ x: 240, y: -24 });
    expect(step(link, "y")).toBe(14);
  });

  it("lands a drop made with snapping paused at the view's edge there too", () => {
    seed([a, b], [link]);
    // let go 7.3px off straight, the drop's grid spot is 6px off
    drag("b", [{ x: 240.4, y: -17.3 }], EDGE);
    expect(node("b").position).toEqual({ x: 240, y: -10 });
    expect(step(link, "y")).toBe(0);
  });

  it("keeps the grid for a drop paused at the edge whose grid spot is out of reach", () => {
    // a 8px lower: b's end is level with a's at b.y = -2. Let go at 4, the
    // drop's grid spot is 8 — 10px off, so the grid stands
    const lower = { ...a, position: { x: 0, y: 8 } };
    seed([lower, b], [link]);
    drag("b", [{ x: 240, y: 4 }], EDGE);
    expect(node("b").position).toEqual({ x: 240, y: 8 });
    expect(step(link, "y")).toBe(10);
  });

  it("does not pull a drag along while snapping is paused at the edge", () => {
    seed([a, b], [link]);
    startDrag("b", EDGE);
    stepTo("b", { x: 240, y: -9.3 }, EDGE);
    // 0.7px off straight, yet the shape stays under the pointer
    expect(node("b").position).toEqual({ x: 240, y: -9.3 });
    drop("b", { x: 240, y: -9.3 }, EDGE);
    expect(node("b").position).toEqual({ x: 240, y: -10 });
  });

  it("lines up the contents a frame carries, step after step, without piling up", () => {
    // b sits 40px down a frame: b's line to a runs straight with the frame at -50
    const frame = makeNode({ id: "f", shape: "frame", x: 200, y: 0, width: 400, height: 300 });
    seed([a, frame, b], [link]);
    startDrag("f");
    const seen: number[] = [];
    for (const y of [-40, -48, -56, -64, -48]) {
      stepTo("f", { x: 200, y });
      seen.push(node("f").position.y);
      expect(node("b").position.y).toBe(node("f").position.y + 40);
    }
    expect(seen).toEqual([-40, -50, -50, -64, -50]);
    expect(step(link, "y")).toBe(0);
    drop("f", { x: 200, y: -48 });
    expect(node("f").position).toEqual({ x: 200, y: -50 });
    expect(node("b").position).toEqual({ x: 240, y: -10 });
  });

  it("keeps an arrow-key nudge on the grid", () => {
    seed([a, b], [link]);
    act(() => {
      flow().onNodesChange([
        { type: "position", id: "b", position: { x: 240, y: -8 }, dragging: false },
      ]);
    });
    expect(node("b").position).toEqual({ x: 240, y: -8 });
  });
});
