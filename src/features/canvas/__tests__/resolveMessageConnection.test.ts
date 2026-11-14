import { beforeEach, describe, expect, it } from "vitest";

import type { DiagramNode } from "../../../shared/lib/types";

import { handlePointOnNode } from "../../../shared/lib/edgeUtils";
import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { isSequenceMessage } from "../../../shared/lib/edgeUtils";
import { useDiagramStore } from "../../../shared/lib/store";
import {
  isConnectionAllowed,
  resolveMessageConnection,
  SELF_MESSAGE_MIN_DROP,
} from "../DiagramCanvas";

const a = makeNode({ id: "a", shape: "lifeline", x: 0, y: 0, width: 120, height: 360 });
const b = makeNode({ id: "b", shape: "lifeline", x: 300, y: 0, width: 120, height: 360 });
const box = makeNode({ id: "r", x: 600, y: 0 });
const nodes = [a, b, box];

/** absolute y of both endpoints for the resolved handles */
const ys = (handles: { sourceHandle: string; targetHandle: string }, s = a, t = b) => [
  handlePointOnNode(s, handles.sourceHandle).y,
  handlePointOnNode(t, handles.targetHandle).y,
];

describe("resolveMessageConnection (creating messages by canvas drag)", () => {
  it("turns a lifeline pair into a horizontal message at the drag's start y", () => {
    const handles = resolveMessageConnection(
      nodes,
      { source: "a", target: "b" },
      { start: { y: 220 }, point: { y: 260 } },
    )!;
    expect(handles.sourceHandle).toMatch(/^right-/);
    expect(handles.targetHandle).toMatch(/^left-/);
    const [sy, ty] = ys(handles);
    expect(sy).toBeCloseTo(220, 1);
    expect(ty).toBeCloseTo(220, 1); // based on the start y, not the drop y
  });

  it("turns the same lifeline into a self loop as long as the drag", () => {
    const handles = resolveMessageConnection(
      nodes,
      { source: "a", target: "a" },
      { start: { y: 150 }, point: { y: 230 } },
    )!;
    const [sy, ty] = ys(handles, a, a);
    expect(sy).toBeCloseTo(150, 1);
    expect(ty).toBeCloseTo(230, 1);
  });

  it("normalizes the loop so its start is on top even when dragged upward", () => {
    const handles = resolveMessageConnection(
      nodes,
      { source: "a", target: "a" },
      { start: { y: 260 }, point: { y: 180 } },
    )!;
    const [sy, ty] = ys(handles, a, a);
    expect(sy).toBeLessThan(ty);
    expect(sy).toBeCloseTo(180, 1);
  });

  it("returns null without pointer info, leaving it to the store default", () => {
    expect(
      resolveMessageConnection(nodes, { source: "a", target: "b" }, { start: null, point: null }),
    ).toBeNull();
  });

  it("returns null if either side isn't a lifeline", () => {
    const drag = { start: { y: 200 }, point: { y: 200 } };
    expect(resolveMessageConnection(nodes, { source: "a", target: "r" }, drag)).toBeNull();
    expect(resolveMessageConnection(nodes, { source: "r", target: "b" }, drag)).toBeNull();
    expect(resolveMessageConnection(nodes, { source: "a", target: null }, drag)).toBeNull();
  });

  it("falls back to the current pointer y without start", () => {
    const handles = resolveMessageConnection(
      nodes,
      { source: "a", target: "b" },
      { start: null, point: { y: 300 } },
    )!;
    expect(ys(handles)[0]).toBeCloseTo(300, 1);
  });
});

describe("resolveMessageConnection — destroy cap", () => {
  const lifeline = (id: string, x: number, destroyY?: number): DiagramNode =>
    ({
      id,
      type: "shape",
      position: { x, y: 0 },
      width: 120,
      height: 360,
      data: { label: id, shape: "lifeline", color: "violet", ...(destroyY ? { destroyY } : {}) },
    }) as DiagramNode;

  it("caps a message made by a connect drag above the destroy", () => {
    const nodes = [lifeline("a", 0, 200), lifeline("b", 400)];
    const h = resolveMessageConnection(
      nodes,
      { source: "a", target: "b" },
      {
        start: { y: 300 },
        point: { y: 300 },
      },
    );
    if (!h) throw new Error("no handles");
    // node y=0, destroyY=200 → relative pct at most 55.56
    expect(Number.parseFloat(h.sourceHandle.split("-")[1] ?? "0")).toBeLessThanOrEqual(55.6);
  });

  it("keeps a self message above the destroy, return leg included", () => {
    const nodes = [lifeline("a", 0, 200)];
    const h = resolveMessageConnection(
      nodes,
      { source: "a", target: "a" },
      {
        start: { y: 180 },
        point: { y: 260 },
      },
    );
    if (!h) throw new Error("no handles");
    const pct = (id: string) => Number.parseFloat(id.split("-")[1] ?? "0");
    expect(pct(h.targetHandle)).toBeLessThanOrEqual(55.6);
    expect(pct(h.sourceHandle)).toBeLessThan(pct(h.targetHandle));
  });
});

describe("self-message drop check (#99)", () => {
  const drag = (from: number | null, to: number | null) => ({
    start: from === null ? null : { y: from },
    point: to === null ? null : { y: to },
  });

  it("allows the connection when dragged far enough on the same lifeline", () => {
    expect(isConnectionAllowed(nodes, { source: "a", target: "a" }, drag(100, 160))).toBe(true);
    // Same when dragged upward — it's distance, not sign
    expect(isConnectionAllowed(nodes, { source: "a", target: "a" }, drag(160, 100))).toBe(true);
  });

  it("allows the 16px boundary and rejects anything below it", () => {
    expect(
      isConnectionAllowed(
        nodes,
        { source: "a", target: "a" },
        drag(100, 100 + SELF_MESSAGE_MIN_DROP),
      ),
    ).toBe(true);
    expect(
      isConnectionAllowed(
        nodes,
        { source: "a", target: "a" },
        drag(100, 100 + SELF_MESSAGE_MIN_DROP - 1),
      ),
    ).toBe(false);
  });

  it("rejects dropping in place — that gesture stays a connection cancel", () => {
    // Rejection is what makes onConnectEnd show the drop menu (existing behavior)
    expect(isConnectionAllowed(nodes, { source: "a", target: "a" }, drag(100, 100))).toBe(false);
  });

  it("rejects when there's no drag trace", () => {
    expect(isConnectionAllowed(nodes, { source: "a", target: "a" }, drag(100, null))).toBe(false);
    expect(isConnectionAllowed(nodes, { source: "a", target: "a" }, drag(null, null))).toBe(false);
  });

  it("allows different lifelines regardless of distance", () => {
    expect(isConnectionAllowed(nodes, { source: "a", target: "b" }, drag(100, 100))).toBe(true);
  });

  it("leaves a box's self connection alone (lifelines only)", () => {
    expect(isConnectionAllowed(nodes, { source: "r", target: "r" }, drag(100, 100))).toBe(true);
  });

  it("an allowed drop actually produces self-loop handles", () => {
    // Checks that decision and creation connect — fixing only one of them still fails
    const conn = { source: "a", target: "a" };
    const d = drag(150, 230);
    expect(isConnectionAllowed(nodes, conn, d)).toBe(true);
    const handles = resolveMessageConnection(nodes, conn, d)!;
    expect(handles).not.toBeNull();
    const [sy, ty] = ys(handles, a, a);
    expect(Math.abs(ty - sy)).toBeCloseTo(80, 0);
  });
});

describe("from drop to an actual self-message edge (#99)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([a, b, box], []), null);
  });

  /** Exactly what the canvas's handleConnect does — decision → handle resolution → store */
  const dropOnSelf = (from: number, to: number): boolean => {
    const conn = { source: "a", target: "a", sourceHandle: null, targetHandle: null };
    const drag = { start: { y: from }, point: { y: to } };
    const { nodes } = useDiagramStore.getState();
    if (!isConnectionAllowed(nodes, conn, drag)) return false;
    const handles = resolveMessageConnection(nodes, conn, drag);
    useDiagramStore.getState().onConnect(handles ? { ...conn, ...handles } : conn);
    return true;
  };

  it("an allowed drop leaves an edge recognized as a sequence message", () => {
    expect(dropOnSelf(150, 230)).toBe(true);
    const st = useDiagramStore.getState();
    expect(st.edges).toHaveLength(1);
    const e = st.edges[0]!;
    expect(e.source).toBe("a");
    expect(e.target).toBe("a");
    expect(isSequenceMessage(e, st.nodes)).toBe(true);
    // Messages are straight regardless of the last style
    expect(e.data?.pathStyle).toBe("straight");
    const [sy, ty] = ys({ sourceHandle: e.sourceHandle!, targetHandle: e.targetHandle! }, a, a);
    expect(Math.abs(ty - sy)).toBeCloseTo(80, 0);
  });

  it("a rejected drop creates no edge", () => {
    expect(dropOnSelf(150, 158)).toBe(false);
    expect(useDiagramStore.getState().edges).toHaveLength(0);
  });

  it("creating a self message is undone by one undo", () => {
    dropOnSelf(150, 230);
    expect(useDiagramStore.getState().edges).toHaveLength(1);
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().edges).toHaveLength(0);
  });
});
